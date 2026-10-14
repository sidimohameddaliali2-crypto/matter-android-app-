// Regression tests for delivery parsing, offline recovery and notifications.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import api from '../src/services/api';
import { deliveryService } from '../src/services/deliveryService';
import { bagService } from '../src/services/bagService';
import { driverService } from '../src/services/driverService';
import { offlineSyncService as sync } from '../src/services/offlineSyncService';
import { parseDeliveryResponse, attachDisplayStatus } from '../src/services/deliveryParser';
import deliveriesReducer, { completeDelivery, returnBag, processSyncQueue, fetchDriverDeliveries, updateDeliveryStatus } from '../src/store/deliveriesSlice';
import notificationsReducer, { addNotification, markAllRead } from '../src/store/notificationsSlice';
import { isBagCode, toBagResourceId, toBagScanCode } from '../src/utils/bagId';
import { isSameUAEDay } from '../src/utils/uaeTime';

jest.mock('../src/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), defaults: { baseURL: 'https://test.invalid/api' } }
}));
jest.mock('../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const store = () => configureStore({ reducer: { deliveries: deliveriesReducer, notifications: notificationsReducer } });
const httpError = (status) => Object.assign(new Error('Rejected'), { response: { status, data: { message: 'Rejected' } } });
beforeEach(async () => {
  jest.clearAllMocks();
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset(); api.patch.mockReset();
  await sync.configureAccount(null);
  await AsyncStorage.clear();
});
afterEach(() => jest.useRealTimers());

describe('Delivery parsing and bag helpers', () => {
  test.each([
    [[{ _id: 'a' }]],
    [{ deliveries: [{ _id: 'a' }] }],
    [{ success: true, data: { deliveries: [{ _id: 'a' }] } }],
    [{ data: [{ _id: 'a' }] }],
  ])('parses supported envelope %#', (payload) => expect(parseDeliveryResponse(payload).deliveries).toEqual([{ _id: 'a' }]));
  test('handles missing response', () => expect(parseDeliveryResponse(null).deliveries).toEqual([]));
  test.each(['delivery_failed', 'delivery_cancelled', 'rejected'])('keeps %s out of delivered', status => expect(attachDisplayStatus({ status }).displayStatus).toBe('cancelled'));
  test('out_for_delivery remains pending', () => expect(attachDisplayStatus({ status: 'out_for_delivery' }).displayStatus).toBe('pending'));
  test('normalizes scan and resource IDs', () => {
    expect(toBagResourceId(' bag_0042 ')).toBe('BAG-0042');
    expect(toBagScanCode('BAG-0042')).toBe('BAG_0042');
    expect(isBagCode('OTHER-42')).toBe(false);
  });
  test('rejects empty bag suffix', () => expect(isBagCode('BAG-')).toBe(false));
  test('UAE midnight boundary uses UTC+4', () => {
    expect(isSameUAEDay('2026-10-12T20:01:00Z', new Date('2026-10-13T05:00:00Z'))).toBe(true);
    expect(isSameUAEDay('2026-10-12T19:59:00Z', new Date('2026-10-13T05:00:00Z'))).toBe(false);
  });
});

describe('API services and offline operations', () => {
  test('single delivery unwraps server envelope', async () => {
    api.get.mockResolvedValue({ data: { data: { delivery: { _id: 'a' }, bags: [] } } });
    expect(await deliveryService.getDelivery('a')).toEqual({ _id: 'a' });
  });
  test('live bag return normalizes QR resource ID', async () => {
    api.patch.mockResolvedValue({ data: {} });
    await bagService.returnBag('BAG_0042', 'note');
    expect(api.patch).toHaveBeenCalledWith('/bags/BAG-0042/return', { bagId: 'BAG-0042', notes: 'note' });
  });
  test('delivery completes with top-level location and bag ID', async () => {
    api.post.mockResolvedValue({ data: { success: true } });
    await store().dispatch(completeDelivery({ deliveryId: 'a', proof: { verified: true }, bagId: 'BAG_0042', location: { lat: 25, lng: 55 } })).unwrap();
    expect(api.post).toHaveBeenCalledWith('/deliveries/a/complete', { status: 'delivered', proof: { verified: true }, bagId: 'BAG_0042', location: { lat: 25, lng: 55 } });
  });
  test('network failure queues completion and later retry succeeds', async () => {
    api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });
    await store().dispatch(completeDelivery({ deliveryId: 'a', proof: {} }));
    expect((await sync.getSyncQueue())[0].status).toBe('pending');
    await sync.processSyncQueue();
    expect((await sync.getSyncQueue())[0].status).toBe('synced');
  });
  test('failed sync items are retried without aborting the batch', async () => {
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    await sync.addToSyncQueue('b', 'completeDelivery', {});
    api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });
    await sync.processSyncQueue();
    expect((await sync.getSyncQueue()).map(i => i.status)).toEqual(['failed', 'synced']);
    await sync.processSyncQueue();
    expect((await sync.getSyncQueue()).map(i => i.status)).toEqual(['synced', 'synced']);
  });
  test('HTTP 400 validation failure is not queued', async () => {
    api.post.mockRejectedValue(httpError(400));
    const result = await store().dispatch(completeDelivery({ deliveryId: 'a', proof: {} }));
    expect(result.meta.requestStatus).toBe('rejected');
    expect(await sync.getSyncQueue()).toHaveLength(0);
  });
  test('offline QR bag return normalizes resource ID on retry', async () => {
    api.patch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });
    await store().dispatch(returnBag({ bagId: 'BAG_0042', notes: '' }));
    await sync.processSyncQueue();
    expect(api.patch.mock.calls.map(c => c[0])).toEqual(['/bags/BAG-0042/return', '/bags/BAG-0042/return']);
  });
  test('concurrent queue additions preserve both operations', async () => {
    await Promise.all([sync.addToSyncQueue('a', 'completeDelivery', {}), sync.addToSyncQueue('b', 'completeDelivery', {})]);
    expect(await sync.getSyncQueue()).toHaveLength(2);
  });
  test('interrupted syncing item is retried', async () => {
    const item = await sync.addToSyncQueue('a', 'completeDelivery', {});
    await sync.updateSyncItemStatus(item.id, 'syncing');
    api.post.mockResolvedValue({ data: {} });
    await sync.processSyncQueue();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect((await sync.getSyncQueue())[0].status).toBe('synced');
  });
  test('overlapping processors send completion once', async () => {
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    api.post.mockResolvedValue({ data: {} });
    await Promise.all([sync.processSyncQueue(), sync.processSyncQueue()]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  test('Redux exposes failed queue items', async () => {
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    api.post.mockRejectedValue(new Error('offline'));
    const s = store();
    await s.dispatch(processSyncQueue());
    expect(s.getState().deliveries.syncStatus).toBe('error');
    expect(s.getState().deliveries.syncQueue[0].status).toBe('failed');
  });
  test('transient failures remain retryable after five attempts', async () => {
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    api.post.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 6; i++) await sync.processSyncQueue();
    expect(api.post).toHaveBeenCalledTimes(6);
    expect((await sync.getSyncQueue())[0].status).toBe('failed');
  });
  test('photo upload followed by completion in offline replay', async () => {
    const upload = jest.spyOn(deliveryService, 'uploadPhoto').mockResolvedValue('https://test.invalid/photo.jpg');
    api.post.mockResolvedValue({ data: {} });
    await sync.addToSyncQueue('a', 'completeDeliveryWithPhoto', { photo: { uri: 'file://a.jpg' }, proof: { verified: true }, location: { lat: 25, lng: 55 } });
    await sync.processSyncQueue();
    expect(api.post).toHaveBeenCalledWith('/deliveries/a/complete', expect.objectContaining({ photoUrl: 'https://test.invalid/photo.jpg', location: { lat: 25, lng: 55 }, proof: expect.objectContaining({ images: ['https://test.invalid/photo.jpg'] }) }));
    upload.mockRestore();
  });
  test('HTTP 200 upload missing URL is rejected', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '{"success":true}' });
    try { await expect(deliveryService.uploadPhoto({ uri: 'file://a.jpg' })).rejects.toThrow('no image URL'); }
    finally { global.fetch = previousFetch; }
  });
  test('clears only successfully synced items', async () => {
    const item = await sync.addToSyncQueue('a', 'completeDelivery', {});
    await sync.addToSyncQueue('b', 'completeDelivery', {});
    await sync.updateSyncItemStatus(item.id, 'synced');
    await sync.clearSyncedItems();
    expect((await sync.getSyncQueue()).map(i => i.deliveryId)).toEqual(['b']);
  });
  test('today endpoint falls back with correct UAE date range after 14:00', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-13T10:01:00Z'));
    api.get.mockRejectedValueOnce(new Error('missing route')).mockResolvedValue({ data: { deliveries: [] } });
    await driverService.getTodayDeliveries('driver');
    expect(api.get).toHaveBeenLastCalledWith('/deliveries', { params: { driverId: 'driver', dateFrom: '2026-10-12T20:00:00.000Z', dateTo: '2026-10-14T19:59:59.999Z', limit: 5000 } });
  });
  test('fetch normalizes delivery state into Redux', async () => {
    api.get.mockResolvedValue({ data: { data: { deliveries: [{ _id: 'a', status: 'assigned' }] } } });
    const s = store();
    await s.dispatch(fetchDriverDeliveries('driver')).unwrap();
    expect(s.getState().deliveries.deliveries[0].displayStatus).toBe('pending');
  });
});

describe('Notification store', () => {
  test('deduplicates receive/tap and marks read', () => {
    let state = notificationsReducer(undefined, addNotification({ id: 'one', title: 'Assigned' }));
    state = notificationsReducer(state, addNotification({ id: 'one', read: true }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].read).toBe(true);
    state = notificationsReducer(state, addNotification({ id: 'two' }));
    expect(notificationsReducer(state, markAllRead()).items.every(i => i.read)).toBe(true);
  });
  test('caps inbox at 30', () => {
    let state;
    for (let i = 0; i < 35; i++) state = notificationsReducer(state, addNotification({ id: String(i) }));
    expect(state.items).toHaveLength(30);
    expect(state.items[0].id).toBe('34');
  });
});

describe('Session isolation and durable recovery', () => {
  test('switching accounts isolates and preserves unsent work', async () => {
    await sync.configureAccount('driver-a');
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    await sync.configureAccount('driver-b');
    expect(await sync.getSyncQueue()).toEqual([]);
    api.post.mockResolvedValue({ data: {} });
    await sync.processSyncQueue();
    expect(api.post).not.toHaveBeenCalled();
    await sync.configureAccount('driver-a');
    expect((await sync.getSyncQueue())[0].deliveryId).toBe('a');
  });
  test('session change stops remaining replay requests', async () => {
    await sync.configureAccount('driver-a');
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    await sync.addToSyncQueue('b', 'completeDelivery', {});
    let resolve;
    const started = new Promise(ready => api.post.mockImplementation(() => { ready(); return new Promise(r => { resolve = r; }); }));
    const run = sync.processSyncQueue();
    await started;
    await sync.configureAccount('driver-b');
    resolve({ data: {} });
    await run;
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(await sync.getSyncQueue()).toEqual([]);
    await sync.configureAccount('driver-a');
    expect((await sync.getSyncQueue()).map(i => i.status)).toEqual(['synced', 'pending']);
  });
  test('validation failures in replay are retained but not repeatedly sent', async () => {
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    api.post.mockRejectedValue(httpError(400));
    await sync.processSyncQueue();
    await sync.processSyncQueue();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect((await sync.getSyncQueue())[0]).toEqual(expect.objectContaining({ status: 'failed', retryable: false }));
  });
  test('repeated offline bag submissions keep one saved operation', async () => {
    api.patch.mockRejectedValue(new Error('offline'));
    const s = store();
    const first = await s.dispatch(returnBag({ bagId: 'BAG_0042', notes: '' })).unwrap();
    const second = await s.dispatch(returnBag({ bagId: 'BAG-0042', notes: '' })).unwrap();
    expect(first.queued).toBe(true);
    expect(second.queueItem.id).toBe(first.queueItem.id);
    expect(await sync.getSyncQueue()).toHaveLength(1);
  });
  test('failed queue write rejects completion without changing local status', async () => {
    const s = store();
    s.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [{ _id: 'a', status: 'assigned', displayStatus: 'pending' }], meta: null }));
    api.post.mockRejectedValue(new Error('offline'));
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(s.dispatch(completeDelivery({ deliveryId: 'a', proof: {} })).unwrap()).rejects.toContain('Could not save offline');
    expect(s.getState().deliveries.deliveries[0].displayStatus).toBe('pending');
  });
  test('late fetch response cannot restore previous account data after reset', async () => {
    const s = store();
    s.dispatch(fetchDriverDeliveries.pending('old-request', 'driver-a'));
    s.dispatch({ type: 'session/reset' });
    s.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [{ _id: 'a' }], meta: null }, 'old-request', 'driver-a'));
    expect(s.getState().deliveries.deliveries).toEqual([]);
  });
  test('photo replay reuses an uploaded URL after completion fails', async () => {
    const upload = jest.spyOn(deliveryService, 'uploadPhoto').mockResolvedValue('https://test.invalid/photo.jpg');
    await sync.addToSyncQueue('a', 'completeDeliveryWithPhoto', { photo: { uri: 'file://a.jpg' }, proof: {} });
    api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });
    await sync.processSyncQueue();
    await sync.processSyncQueue();
    expect(upload).toHaveBeenCalledTimes(1);
    expect((await sync.getSyncQueue())[0].status).toBe('synced');
    upload.mockRestore();
  });
  test('corrupt queue is reported without overwriting saved data', async () => {
    await AsyncStorage.setItem(sync.SYNC_QUEUE_KEY, '{broken');
    await expect(sync.addToSyncQueue('a', 'completeDelivery', {})).rejects.toThrow();
    expect(await AsyncStorage.getItem(sync.SYNC_QUEUE_KEY)).toBe('{broken');
  });
  test('successful replay is removed from storage after updating Redux', async () => {
    const s = store();
    s.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [{ _id: 'a', displayStatus: 'pending' }], meta: null }));
    await sync.addToSyncQueue('a', 'completeDelivery', {});
    api.post.mockResolvedValue({ data: {} });
    await s.dispatch(processSyncQueue()).unwrap();
    expect(s.getState().deliveries.deliveries[0].displayStatus).toBe('delivered');
    expect(await sync.getSyncQueue()).toEqual([]);
  });
  test('concurrent delivery mutations both update their own delivery', () => {
    const s = store();
    s.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [{ _id: 'a', displayStatus: 'pending' }, { _id: 'b', displayStatus: 'pending' }], meta: null }));
    const a = { deliveryId: 'a', status: 'cancelled' };
    const b = { deliveryId: 'b', status: 'cancelled' };
    s.dispatch(updateDeliveryStatus.pending('request-a', a));
    s.dispatch(updateDeliveryStatus.pending('request-b', b));
    s.dispatch(updateDeliveryStatus.fulfilled({}, 'request-a', a));
    s.dispatch(updateDeliveryStatus.fulfilled({}, 'request-b', b));
    expect(s.getState().deliveries.deliveries.map(d => d.displayStatus)).toEqual(['cancelled', 'cancelled']);
  });
  test('a changed status request is preserved while an earlier status is syncing', async () => {
    const original = await sync.addToSyncQueue('a', 'updateStatus', { status: 'cancelled' });
    await sync.updateSyncItemStatus(original.id, 'syncing');
    const next = await sync.addToSyncQueue('a', 'updateStatus', { status: 'pending' });
    expect(next.id).not.toBe(original.id);
    expect((await sync.getSyncQueue()).map(i => i.data.status)).toEqual(['cancelled', 'pending']);
  });
});
