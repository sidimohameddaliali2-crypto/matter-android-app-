import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { deliveryService } from './deliveryService';
import logger from '../utils/logger';

const MAX_SYNC_RETRIES = 5;

export const offlineSyncService = {
  SYNC_QUEUE_KEY: 'delivery_sync_queue',
  SYNC_STATUS_KEY: 'delivery_sync_status',
  MAX_SYNC_RETRIES,

  // ADD ITEM TO SYNC QUEUE - for offline operations
  async addToSyncQueue(deliveryId, action, data) {
    try {
      logger.log('📝 offlineSyncService: Adding to queue:', action, deliveryId);
      const queue = await this.getSyncQueue();
      const queueItem = {
        id: `${deliveryId}_${action}_${Date.now()}`,
        deliveryId,
        action,
        data,
        timestamp: new Date().toISOString(),
        status: 'pending',
        retries: 0
      };
      queue.push(queueItem);
      await AsyncStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(queue));
      logger.log('✅ Item added to sync queue');
      return queueItem;
    } catch (error) {
      logger.error('❌ Error adding to sync queue:', error);
      throw error;
    }
  },

  // GET SYNC QUEUE
  async getSyncQueue() {
    try {
      const queue = await AsyncStorage.getItem(this.SYNC_QUEUE_KEY);
      return queue ? JSON.parse(queue) : [];
    } catch (error) {
      logger.error('❌ Error getting sync queue:', error);
      return [];
    }
  },

  // PROCESS SYNC QUEUE - sync all pending AND previously-failed operations
  // (up to MAX_SYNC_RETRIES each). Previously this only ever looked at
  // 'pending' items — once an item failed once, its status flipped to
  // 'failed' and it was never picked up again, so the "Retry" button in
  // SyncStatusBanner silently did nothing for anything that had failed even
  // once.
  async processSyncQueue() {
    try {
      logger.log('🔄 offlineSyncService: Processing sync queue');
      const queue = await this.getSyncQueue();
      const retryableItems = queue.filter(
        (item) =>
          (item.status === 'pending' || item.status === 'failed') &&
          (item.retries || 0) < MAX_SYNC_RETRIES
      );

      // Each item's own failure is already persisted by syncItem; catch here
      // too so one still-broken item can't abort the rest of the batch.
      for (const item of retryableItems) {
        try {
          await this.syncItem(item);
        } catch {
          // Already logged and recorded by syncItem — keep going.
        }
      }

      logger.log('✅ Sync queue processed');
      return await this.getSyncQueue();
    } catch (error) {
      logger.error('❌ Error processing sync queue:', error);
      throw error;
    }
  },

  // SYNC INDIVIDUAL ITEM
  async syncItem(item) {
    await this.updateSyncItemStatus(item.id, 'syncing');
    try {
      logger.log(`📤 offlineSyncService: Syncing ${item.action} for delivery ${item.deliveryId}`);

      let response;
      switch (item.action) {
        case 'completeDelivery':
          response = await api.post(`/deliveries/${item.deliveryId}/complete`, item.data);
          break;
        case 'completeDeliveryWithPhoto': {
          // The photo upload itself is what failed live (it's a much bigger
          // request than the completion payload, so it's the first thing to
          // die on a bad connection) — retry it here before completing, same
          // as the live flow would have done if connectivity had held.
          const { photo, proof, bagId, location } = item.data;
          const photoUrl = photo ? await deliveryService.uploadPhoto(photo) : null;
          response = await api.post(`/deliveries/${item.deliveryId}/complete`, {
            status: 'delivered',
            proof: {
              ...proof,
              images: photoUrl ? [photoUrl] : (proof?.images || []),
              photoUrl: photoUrl || proof?.photoUrl || null,
            },
            ...(photoUrl && { photoUrl }),
            ...(bagId && { bagId }),
            ...(location && { location }),
          });
          break;
        }
        case 'updateStatus':
          response = await api.put(`/deliveries/${item.deliveryId}/status`, item.data);
          break;
        case 'returnBag':
          response = await api.patch(`/bags/${item.data.bagId}/return`, item.data);
          break;
        case 'updateLocation':
          response = await api.put(`/drivers/${item.data.driverId}/location`, item.data);
          break;
        default:
          throw new Error(`Unknown sync action: ${item.action}`);
      }

      await this.updateSyncItemStatus(item.id, 'synced');
      logger.log(`✅ ${item.action} synced successfully`);
      return response.data;
    } catch (error) {
      logger.error(`❌ Error syncing ${item.action}:`, error);
      await this.updateSyncItemStatus(item.id, 'failed', error.message, { incrementRetry: true });
      throw error;
    }
  },

  // UPDATE SYNC ITEM STATUS
  async updateSyncItemStatus(itemId, status, error = null, { incrementRetry = false } = {}) {
    try {
      const queue = await this.getSyncQueue();
      const item = queue.find(i => i.id === itemId);
      if (item) {
        item.status = status;
        if (error) item.error = error;
        if (incrementRetry) item.retries = (item.retries || 0) + 1;
        item.lastAttempt = new Date().toISOString();
        await AsyncStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (error) {
      logger.error('❌ Error updating sync status:', error);
    }
  },

  // GET SYNC STATUS - for UI display
  async getSyncStatus(deliveryId) {
    try {
      const queue = await this.getSyncQueue();
      const items = queue.filter(item => item.deliveryId === deliveryId);
      
      if (items.length === 0) return { status: 'synced', items: [] };
      
      const hasFailed = items.some(i => i.status === 'failed');
      const hasPending = items.some(i => i.status === 'pending');
      const isSyncing = items.some(i => i.status === 'syncing');

      let status = 'synced';
      if (hasFailed) status = 'failed';
      else if (isSyncing) status = 'syncing';
      else if (hasPending) status = 'pending';

      return { status, items };
    } catch (error) {
      logger.error('❌ Error getting sync status:', error);
      return { status: 'error', items: [] };
    }
  },

  // CLEAR SYNC QUEUE - remove all synced items
  async clearSyncedItems() {
    try {
      logger.log('🗑️ offlineSyncService: Clearing synced items');
      const queue = await this.getSyncQueue();
      const remaining = queue.filter(item => item.status !== 'synced');
      await AsyncStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(remaining));
      logger.log('✅ Synced items cleared');
    } catch (error) {
      logger.error('❌ Error clearing synced items:', error);
    }
  },

  // CLEAR ALL QUEUE - emergency clear
  async clearAll() {
    try {
      logger.log('🗑️ offlineSyncService: Clearing entire queue');
      await AsyncStorage.removeItem(this.SYNC_QUEUE_KEY);
      logger.log('✅ Queue cleared');
    } catch (error) {
      logger.error('❌ Error clearing queue:', error);
    }
  }
};
