import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { deliveryService } from './deliveryService';
import { toBagResourceId } from '../utils/bagId';

let storageLock = Promise.resolve();
let account = null;
let generation = 0;
const processors = new Map();
let sequence = 0;
const keyForAccount = () => account ? `delivery_sync_queue:${account}` : 'delivery_sync_queue';
// Serialize every read/modify/write, including clearing and status updates.
const locked = operation => {
  const result = storageLock.then(operation);
  storageLock = result.catch(() => {});
  return result;
};
const readQueue = async key => {
  const raw = await AsyncStorage.getItem(key);
  const queue = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(queue)) throw new Error('Invalid offline queue. Saved actions have not been overwritten.');
  return queue;
};
export const isRetryableError = error => {
  if (error?.retryable === false) return false;
  const status = error?.response?.status || error?.status;
  return !status || status === 408 || status === 429 || status >= 500;
};

export const offlineSyncService = {
  SYNC_QUEUE_KEY: 'delivery_sync_queue',
  MAX_SYNC_RETRIES: 5,
  getSessionGeneration: () => generation,
  // Keep unsent work for its owner. Retain the old unscoped queue without
  // assigning it to an arbitrary login, since its owner cannot be determined.
  async configureAccount(id) {
    const nextAccount = id ? String(id) : null;
    if (nextAccount === account) { await storageLock; return; }
    account = nextAccount;
    generation += 1;
    await storageLock;
  },
  async addToSyncQueue(deliveryId, action, data, expectedGeneration = generation) {
    const key = keyForAccount();
    const normalized = action === 'returnBag' ? { ...data, bagId: toBagResourceId(data.bagId) } : data;
    const resourceId = action === 'returnBag' ? normalized.bagId : deliveryId;
    return locked(async () => {
      if (expectedGeneration !== generation) throw Object.assign(new Error('Session changed. Please try again.'), { retryable: false });
      const queue = await readQueue(key);
      const existing = queue.find(item => item.deliveryId === resourceId && item.action === action && item.status !== 'synced');
      if (existing?.status === 'syncing' && JSON.stringify(existing.data) === JSON.stringify(normalized)) return existing;
      if (existing && existing.status !== 'syncing') {
        Object.assign(existing, { data: normalized, status: 'pending', error: null, retryable: true });
        await AsyncStorage.setItem(key, JSON.stringify(queue));
        return existing;
      }
      const item = { id: `${resourceId}_${action}_${Date.now()}_${++sequence}`, deliveryId: resourceId, action, data: normalized, timestamp: new Date().toISOString(), status: 'pending', retries: 0 };
      queue.push(item);
      await AsyncStorage.setItem(key, JSON.stringify(queue));
      return item;
    });
  },
  async getSyncQueue() {
    const key = keyForAccount();
    return locked(() => readQueue(key));
  },
  processSyncQueue() {
    const key = keyForAccount();
    if (processors.has(key)) return processors.get(key);
    const currentGeneration = generation;
    const run = (async () => {
      const queue = await locked(() => readQueue(key));
      // A persisted 'syncing' item is an interrupted attempt. One processor
      // prevents overlapping replay; transient failures remain retryable.
      for (const item of queue) {
        if (currentGeneration !== generation) break;
        if (item.status === 'synced' || item.retryable === false) continue;
        try { await this.syncItem(item, key, currentGeneration); } catch { /* Failure is persisted; continue the batch. */ }
      }
      return locked(() => readQueue(key));
    })();
    processors.set(key, run);
    run.finally(() => { if (processors.get(key) === run) processors.delete(key); }).catch(() => {});
    return run;
  },
  async syncItem(item, key = keyForAccount(), currentGeneration = generation) {
    if (currentGeneration !== generation) return;
    await this.updateSyncItemStatus(item.id, 'syncing', null, { key });
    try {
      const token = await AsyncStorage.getItem('token');
      const options = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
      if (currentGeneration !== generation) return;
      let response;
      switch (item.action) {
        case 'completeDelivery': response = options ? await api.post(`/deliveries/${item.deliveryId}/complete`, item.data, options) : await api.post(`/deliveries/${item.deliveryId}/complete`, item.data); break;
        case 'completeDeliveryWithPhoto': {
          const { photo, proof, bagId, location } = item.data;
          const photoUrl = item.data.photoUrl || (photo ? await deliveryService.uploadPhoto(photo, token) : null);
          if (currentGeneration !== generation) return;
          if (photoUrl) await locked(async () => {
            const queue = await readQueue(key);
            const saved = queue.find(i => i.id === item.id);
            if (saved) saved.data.photoUrl = photoUrl;
            await AsyncStorage.setItem(key, JSON.stringify(queue));
          });
          const payload = {
            status: 'delivered',
            proof: { ...proof, images: photoUrl ? [photoUrl] : (proof?.images || []), photoUrl: photoUrl || proof?.photoUrl || null },
            ...(photoUrl && { photoUrl }), ...(bagId && { bagId }), ...(location && { location }),
          };
          response = options ? await api.post(`/deliveries/${item.deliveryId}/complete`, payload, options) : await api.post(`/deliveries/${item.deliveryId}/complete`, payload);
          break;
        }
        case 'updateStatus': response = options ? await api.put(`/deliveries/${item.deliveryId}/status`, item.data, options) : await api.put(`/deliveries/${item.deliveryId}/status`, item.data); break;
        case 'returnBag': {
          const bagId = toBagResourceId(item.data.bagId);
          response = options ? await api.patch(`/bags/${bagId}/return`, { ...item.data, bagId }, options) : await api.patch(`/bags/${bagId}/return`, { ...item.data, bagId });
          break;
        }
        case 'updateLocation': response = options ? await api.put(`/drivers/${item.data.driverId}/location`, item.data, options) : await api.put(`/drivers/${item.data.driverId}/location`, item.data); break;
        default: throw Object.assign(new Error(`Unknown sync action: ${item.action}`), { retryable: false });
      }
      await this.updateSyncItemStatus(item.id, 'synced', null, { key });
      return response.data;
    } catch (error) {
      await this.updateSyncItemStatus(item.id, 'failed', error.message, { key, incrementRetry: true, retryable: isRetryableError(error) });
      throw error;
    }
  },
  async updateSyncItemStatus(itemId, status, error = null, { incrementRetry = false, retryable, key = keyForAccount() } = {}) {
    return locked(async () => {
      const queue = await readQueue(key);
      const item = queue.find(i => i.id === itemId);
      if (!item) return;
      item.status = status;
      item.error = error;
      if (incrementRetry) item.retries = (item.retries || 0) + 1;
      if (retryable !== undefined) item.retryable = retryable;
      item.lastAttempt = new Date().toISOString();
      await AsyncStorage.setItem(key, JSON.stringify(queue));
    });
  },
  async getSyncStatus(deliveryId) {
    const items = (await this.getSyncQueue()).filter(item => item.deliveryId === deliveryId);
    const status = ['failed', 'syncing', 'pending'].find(s => items.some(item => item.status === s)) || 'synced';
    return { status, items };
  },
  async clearSyncedItems() {
    const key = keyForAccount();
    return locked(async () => AsyncStorage.setItem(key, JSON.stringify((await readQueue(key)).filter(item => item.status !== 'synced'))));
  },
  async clearAll() {
    const key = keyForAccount();
    return locked(() => AsyncStorage.removeItem(key));
  },
};
