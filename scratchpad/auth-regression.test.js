import React from 'react';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { authService } from '../src/services/authService';
import { notificationService } from '../src/services/notificationService';
import { pushTokenService } from '../src/services/pushTokenService';
import deliveriesReducer, { fetchDriverDeliveries } from '../src/store/deliveriesSlice';
import notificationsReducer, { addNotification } from '../src/store/notificationsSlice';
import { offlineSyncService } from '../src/services/offlineSyncService';
import usePushNotificationDeepLink from '../src/hooks/usePushNotificationDeepLink';
import * as Notifications from 'expo-notifications';
import { navigate } from '../src/navigation/navigationRef';

jest.mock('../src/services/api', () => ({ __esModule: true, default: {}, registerUnauthorizedHandler: jest.fn() }));
jest.mock('../src/services/authService', () => ({ authService: { getMe: jest.fn(), login: jest.fn(), logout: jest.fn() } }));
jest.mock('../src/services/notificationService', () => ({ notificationService: { getExpoPushTokenAsync: jest.fn().mockResolvedValue(null), addNotificationResponseListener: jest.fn().mockReturnValue({ remove: jest.fn() }) } }));
jest.mock('../src/services/pushTokenService', () => ({ pushTokenService: { unregisterPushToken: jest.fn().mockResolvedValue(), registerPushToken: jest.fn().mockResolvedValue() } }));
jest.mock('../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: jest.fn() }));
jest.mock('../src/navigation/navigationRef', () => ({ navigate: jest.fn() }));

let context;
let checkColdStart;
function Probe() { context = useAuth(); return <Text>{context.loading ? 'loading' : context.user ? 'logged in' : 'logged out'}</Text>; }
function PushProbe() { checkColdStart = usePushNotificationDeepLink(); return null; }
beforeEach(async () => {
  jest.clearAllMocks();
  await offlineSyncService.configureAccount(null);
  await AsyncStorage.clear();
  authService.getMe.mockReset();
  authService.login.mockReset();
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

test('fresh install shows logged out', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged out')).toBeTruthy());
  expect(authService.getMe).not.toHaveBeenCalled();
});
test('direct me envelope restores stored session', async () => {
  await AsyncStorage.setItem('token', 'test-token');
  authService.getMe.mockResolvedValue({ user: { id: 'a' }, driverProfile: { id: 'a' } });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged in')).toBeTruthy());
});
test('network outage preserves existing login token', async () => {
  await AsyncStorage.setItem('token', 'test-token');
  authService.getMe.mockRejectedValue(new Error('Network error'));
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged out')).toBeTruthy());
  expect(await AsyncStorage.getItem('token')).toBe('test-token');
});
test('wrapped me response restores user', async () => {
  await AsyncStorage.setItem('token', 'test-token');
  authService.getMe.mockResolvedValue({ success: true, data: { user: { id: 'a' }, driverProfile: { id: 'a' } } });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged in')).toBeTruthy());
  expect(await AsyncStorage.getItem('token')).toBe('test-token');
});
test('login accepts wrapped envelope and stores token', async () => {
  authService.login.mockResolvedValue({ success: true, data: { token: 'new-token', user: { id: 'a' }, driverProfile: { id: 'a' } } });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged out')).toBeTruthy());
  await act(async () => context.login('test', 'test'));
  expect(screen.getByText('logged in')).toBeTruthy();
  expect(await AsyncStorage.getItem('token')).toBe('new-token');
});
test('logout clears customer deliveries and inbox while isolating saved work', async () => {
  const store = configureStore({ reducer: { deliveries: deliveriesReducer, notifications: notificationsReducer } });
  store.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [{ _id: 'private-a', customerName: 'Previous driver customer' }], meta: null }));
  store.dispatch(addNotification({ id: 'private-notification', deliveryId: 'private-a' }));
  await offlineSyncService.configureAccount('a');
  await offlineSyncService.addToSyncQueue('private-a', 'completeDelivery', {});
  await AsyncStorage.setItem('token', 'test-token');
  authService.getMe.mockResolvedValue({ user: { id: 'a' } });
  render(<Provider store={store}><AuthProvider><Probe /></AuthProvider></Provider>);
  await waitFor(() => expect(screen.getByText('logged in')).toBeTruthy());
  await act(async () => context.logout());
  expect(screen.getByText('logged out')).toBeTruthy();
  expect(await AsyncStorage.getItem('token')).toBeNull();
  expect(await offlineSyncService.getSyncQueue()).toHaveLength(0);
  expect(store.getState().deliveries.deliveries).toHaveLength(0);
  expect(store.getState().notifications.items).toHaveLength(0);
  await offlineSyncService.configureAccount('a');
  expect(await offlineSyncService.getSyncQueue()).toHaveLength(1);
});
test('notification taps record inbox item and navigate to delivery', async () => {
  const store = configureStore({ reducer: { notifications: notificationsReducer } });
  render(<Provider store={store}><PushProbe /></Provider>);
  const handler = notificationService.addNotificationResponseListener.mock.calls[0][0];
  await act(async () => handler({ notification: { request: { identifier: 'one', content: { title: 'Assigned', data: { type: 'delivery_created', deliveryId: 'a' } } } } }));
  expect(store.getState().notifications.items[0].read).toBe(true);
  expect(navigate).toHaveBeenCalledWith('Main', { screen: 'Deliveries', params: { screen: 'DeliveryDetails', params: { deliveryId: 'a' } } });
});
test('removed delivery notification records item without navigating', async () => {
  const store = configureStore({ reducer: { notifications: notificationsReducer } });
  render(<Provider store={store}><PushProbe /></Provider>);
  const handler = notificationService.addNotificationResponseListener.mock.calls[0][0];
  await act(async () => handler({ notification: { request: { identifier: 'one', content: { data: { type: 'delivery_removed', deliveryId: 'a' } } } } }));
  expect(store.getState().notifications.items).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
});
test('old cold-start notification is handled once across launches', async () => {
  Notifications.getLastNotificationResponseAsync.mockResolvedValue({ notification: { request: { identifier: 'old', content: { data: { type: 'delivery_created', deliveryId: 'a' } } } } });
  const store = configureStore({ reducer: { notifications: notificationsReducer } });
  const first = render(<Provider store={store}><PushProbe /></Provider>);
  await act(async () => checkColdStart());
  first.unmount();
  render(<Provider store={store}><PushProbe /></Provider>);
  await act(async () => checkColdStart());
  expect(navigate).toHaveBeenCalledTimes(1);
});

test('cached session restores offline access for its original account', async () => {
  await AsyncStorage.setItem('token', 'test-token');
  await AsyncStorage.setItem('authSession', JSON.stringify({ token: 'test-token', user: { id: 'driver-a' }, driverProfile: { id: 'driver-a' } }));
  authService.getMe.mockRejectedValue(new Error('offline'));
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged in')).toBeTruthy());
  expect(context.user.id).toBe('driver-a');
  expect(await AsyncStorage.getItem('token')).toBe('test-token');
});
test('cached session with a different token is not restored', async () => {
  await AsyncStorage.setItem('token', 'new-token');
  await AsyncStorage.setItem('authSession', JSON.stringify({ token: 'old-token', user: { id: 'driver-a' } }));
  authService.getMe.mockRejectedValue(new Error('offline'));
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('logged out')).toBeTruthy());
  expect(await AsyncStorage.getItem('token')).toBe('new-token');
});
