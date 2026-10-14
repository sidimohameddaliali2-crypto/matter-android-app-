import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { driverService } from '../services/driverService';
import { deliveryService } from '../services/deliveryService';
import { bagService } from '../services/bagService';
import { offlineSyncService, isRetryableError } from '../services/offlineSyncService';
import { parseDeliveryResponse, attachDisplayStatus } from '../services/deliveryParser';

const saveForRetry = async (error, deliveryId, action, data, rejectWithValue, session) => {
  if (session !== offlineSyncService.getSessionGeneration()) return rejectWithValue('Session changed. Please try again.');
  if (!isRetryableError(error)) return rejectWithValue(error.response?.data?.message || error.message || 'Request rejected');
  try {
    const queueItem = await offlineSyncService.addToSyncQueue(deliveryId, action, data, session);
    return { queued: true, queueItem };
  } catch (storageError) {
    return rejectWithValue('Could not save offline. Please try again: ' + storageError.message);
  }
};
const setLocalStatus = (state, id, status) => {
  for (const list of [state.deliveries, state.allDeliveries, state.history]) {
    const delivery = list.find(d => d._id === id || d.id === id);
    if (delivery) Object.assign(delivery, attachDisplayStatus({ ...delivery, status }));
  }
};
const applyQueue = (state, queue) => {
  for (const item of queue) {
    if (item.retryable === false && item.status !== 'synced') continue;
    if (item.action === 'completeDelivery' || item.action === 'completeDeliveryWithPhoto') setLocalStatus(state, item.deliveryId, 'delivered');
    else if (item.action === 'updateStatus') setLocalStatus(state, item.deliveryId, item.data.status);
  }
};
// Async thunks
export const fetchDriverDeliveries = createAsyncThunk(
  'deliveries/fetchDriverDeliveries',
  async (driverId, { rejectWithValue }) => {
    try {
      const response = await driverService.getTodayDeliveries(driverId);
      const { deliveries: rawDeliveries, meta } = parseDeliveryResponse(response);
      const deliveriesArray = Array.isArray(rawDeliveries) ? rawDeliveries : [];
      const deliveries = deliveriesArray.map(attachDisplayStatus);
      const queue = await offlineSyncService.getSyncQueue();
      const view = { deliveries, allDeliveries: [], history: [] };
      applyQueue(view, queue.filter(item => item.status !== 'synced'));
      return { deliveries: view.deliveries, meta, queue };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load deliveries');
    }
  }
);

export const fetchAllDeliveries = createAsyncThunk(
  'deliveries/fetchAllDeliveries',
  async (driverId, { rejectWithValue }) => {
    try {
      const response = await driverService.getDriverDeliveries(driverId);
      const { deliveries: rawDeliveries, meta } = parseDeliveryResponse(response);
      const deliveriesArray = Array.isArray(rawDeliveries) ? rawDeliveries : [];
      const deliveries = deliveriesArray.map(attachDisplayStatus);
      return { deliveries, meta };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load deliveries');
    }
  }
);

// DELIVERY HISTORY - fetch completed deliveries with filtering
export const fetchDeliveryHistory = createAsyncThunk(
  'deliveries/fetchHistory',
  async ({ driverId, dateFrom, dateTo }, { rejectWithValue }) => {
    try {
      const response = await driverService.getDeliveryHistory(driverId, { dateFrom, dateTo });
      const { deliveries: rawDeliveries } = parseDeliveryResponse(response);
      const deliveriesArray = Array.isArray(rawDeliveries) ? rawDeliveries : [];
      return deliveriesArray;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load history');
    }
  }
);

// COMPLETE DELIVERY - submit delivery completion
export const completeDelivery = createAsyncThunk(
  'deliveries/complete',
  async ({ deliveryId, proof, photoUrl, bagId, location }, { rejectWithValue }) => {
    const session = offlineSyncService.getSessionGeneration();
    try {
      const response = await deliveryService.completeDelivery(deliveryId, {
        status: 'delivered',
        proof,
        ...(photoUrl && { photoUrl }),
        ...(bagId && { bagId }),
        // Top-level, not nested in `proof` — the server's complete route
        // reads location from the request body directly (routes/deliveries.js)
        // and would otherwise overwrite/ignore anything nested under proof.
        ...(location && { location })
      });
      return response;
    } catch (error) {
      return saveForRetry(error, deliveryId, 'completeDelivery', {
        status: 'delivered',
        proof,
        photoUrl,
        ...(bagId && { bagId }),
        ...(location && { location })
      }, rejectWithValue, session);
    }
  }
);

// UPDATE DELIVERY STATUS - generic status transition (e.g. reporting a
// failed stop, or retrying one back to pending)
export const updateDeliveryStatus = createAsyncThunk(
  'deliveries/updateStatus',
  async ({ deliveryId, status, proof }, { rejectWithValue }) => {
    const session = offlineSyncService.getSessionGeneration();
    try {
      const response = await deliveryService.updateDeliveryStatus(deliveryId, status, proof);
      return response;
    } catch (error) {
      return saveForRetry(error, deliveryId, 'updateStatus', { status, proof }, rejectWithValue, session);
    }
  }
);

// RETURN BAG - submit bag return
export const returnBag = createAsyncThunk(
  'deliveries/returnBag',
  async ({ bagId, notes, photoUrl }, { rejectWithValue }) => {
    const session = offlineSyncService.getSessionGeneration();
    try {
      const response = await bagService.returnBag(bagId, notes, photoUrl);
      return response;
    } catch (error) {
      return saveForRetry(error, bagId, 'returnBag', { bagId, notes, photoUrl }, rejectWithValue, session);
    }
  }
);

// PROCESS SYNC QUEUE - sync all pending operations
export const processSyncQueue = createAsyncThunk(
  'deliveries/processSyncQueue',
  async (_, { rejectWithValue }) => {
    const session = offlineSyncService.getSessionGeneration();
    try {
      const result = await offlineSyncService.processSyncQueue();
      if (session !== offlineSyncService.getSessionGeneration()) return rejectWithValue('Session changed. Please refresh.');
      await offlineSyncService.clearSyncedItems();
      return result;
    } catch (error) {
      return rejectWithValue(error.message || 'Failed to sync');
    }
  }
);

// Slice
const deliveriesSlice = createSlice({
  name: 'deliveries',
  initialState: {
    deliveries: [],
    allDeliveries: [],
    history: [],
    meta: null,
    loading: false,
    error: null,
    showTodayOnly: true,
    completedDeliveries: [],
    syncQueue: [],
    syncStatus: 'idle', // idle, syncing, error
    syncError: null,
    requests: {},
  },
  reducers: {
    toggleShowTodayOnly: (state) => {
      state.showTodayOnly = !state.showTodayOnly;
    },
    setShowTodayOnly: (state, action) => {
      state.showTodayOnly = action.payload;
    },
    markDeliveryCompleted: (state, action) => {
      if (!state.completedDeliveries.includes(action.payload)) {
        state.completedDeliveries.push(action.payload);
      }
    },
    clearCompletedDeliveries: (state) => {
      state.completedDeliveries = [];
    },
    clearError: (state) => {
      state.error = null;
    },
    setSyncQueue: (state, action) => {
      state.syncQueue = action.payload;
    },
    recordQueuedAction: (state, action) => {
      state.syncQueue = [...state.syncQueue.filter(i => i.id !== action.payload.id), action.payload];
      applyQueue(state, [action.payload]);
    },
    clearSyncError: (state) => {
      state.syncError = null;
    },
  },
  extraReducers: (builder) => {
    builder.addCase('session/reset', () => deliveriesSlice.getInitialState());
    builder
      // Fetch today's deliveries
      .addCase(fetchDriverDeliveries.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.fetchDriverDeliveries = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDriverDeliveries.fulfilled, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchDriverDeliveries !== action.meta.requestId) return;
        state.loading = false;
        state.deliveries = action.payload.deliveries;
        state.meta = action.payload.meta;
        if (action.payload.queue) state.syncQueue = action.payload.queue;
      })
      .addCase(fetchDriverDeliveries.rejected, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchDriverDeliveries !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch all deliveries
      .addCase(fetchAllDeliveries.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.fetchAllDeliveries = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllDeliveries.fulfilled, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchAllDeliveries !== action.meta.requestId) return;
        state.loading = false;
        state.allDeliveries = action.payload.deliveries;
        state.meta = action.payload.meta;
      })
      .addCase(fetchAllDeliveries.rejected, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchAllDeliveries !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch delivery history
      .addCase(fetchDeliveryHistory.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.fetchDeliveryHistory = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDeliveryHistory.fulfilled, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchDeliveryHistory !== action.meta.requestId) return;
        state.loading = false;
        state.history = action.payload;
      })
      .addCase(fetchDeliveryHistory.rejected, (state, action) => {
        if (action.meta.requestId && state.requests?.fetchDeliveryHistory !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.payload;
      })
      // Complete delivery
      .addCase(completeDelivery.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.completeDelivery = [...(state.requests.completeDelivery || []), action.meta.requestId];
        state.syncStatus = 'syncing';
      })
      .addCase(completeDelivery.fulfilled, (state, action) => {
        if (action.meta.requestId && !state.requests?.completeDelivery?.includes(action.meta.requestId)) return;
        state.requests.completeDelivery = (state.requests.completeDelivery || []).filter(id => id !== action.meta.requestId);
        setLocalStatus(state, action.meta.arg.deliveryId, 'delivered');
        if (action.payload?.queueItem) state.syncQueue = [...state.syncQueue.filter(i => i.id !== action.payload.queueItem.id), action.payload.queueItem];
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(completeDelivery.rejected, (state, action) => {
        if (action.meta.requestId && !state.requests?.completeDelivery?.includes(action.meta.requestId)) return;
        state.requests.completeDelivery = (state.requests.completeDelivery || []).filter(id => id !== action.meta.requestId);
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Update delivery status (fail / retry)
      .addCase(updateDeliveryStatus.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.updateDeliveryStatus = [...(state.requests.updateDeliveryStatus || []), action.meta.requestId];
        state.syncStatus = 'syncing';
      })
      .addCase(updateDeliveryStatus.fulfilled, (state, action) => {
        if (action.meta.requestId && !state.requests?.updateDeliveryStatus?.includes(action.meta.requestId)) return;
        state.requests.updateDeliveryStatus = (state.requests.updateDeliveryStatus || []).filter(id => id !== action.meta.requestId);
        setLocalStatus(state, action.meta.arg.deliveryId, action.meta.arg.status);
        if (action.payload?.queueItem) state.syncQueue = [...state.syncQueue.filter(i => i.id !== action.payload.queueItem.id), action.payload.queueItem];
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(updateDeliveryStatus.rejected, (state, action) => {
        if (action.meta.requestId && !state.requests?.updateDeliveryStatus?.includes(action.meta.requestId)) return;
        state.requests.updateDeliveryStatus = (state.requests.updateDeliveryStatus || []).filter(id => id !== action.meta.requestId);
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Return bag
      .addCase(returnBag.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.returnBag = [...(state.requests.returnBag || []), action.meta.requestId];
        state.syncStatus = 'syncing';
      })
      .addCase(returnBag.fulfilled, (state, action) => {
        if (action.meta.requestId && !state.requests?.returnBag?.includes(action.meta.requestId)) return;
        state.requests.returnBag = (state.requests.returnBag || []).filter(id => id !== action.meta.requestId);
        if (action.payload?.queueItem) state.syncQueue = [...state.syncQueue.filter(i => i.id !== action.payload.queueItem.id), action.payload.queueItem];
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(returnBag.rejected, (state, action) => {
        if (action.meta.requestId && !state.requests?.returnBag?.includes(action.meta.requestId)) return;
        state.requests.returnBag = (state.requests.returnBag || []).filter(id => id !== action.meta.requestId);
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Process sync queue
      .addCase(processSyncQueue.pending, (state, action) => {
        if (!state.requests) state.requests = {};
        state.requests.processSyncQueue = action.meta.requestId;
        state.syncStatus = 'syncing';
      })
      .addCase(processSyncQueue.fulfilled, (state, action) => {
        if (action.meta.requestId && state.requests?.processSyncQueue !== action.meta.requestId) return;
        state.syncStatus = 'idle';
        state.syncError = null;
        state.syncQueue = action.payload;
        applyQueue(state, action.payload);
        if (action.payload.some(item => item.status === 'failed')) {
          state.syncStatus = 'error';
          state.syncError = 'Some saved actions could not be synced. Pull to refresh to retry.';
        }
      })
      .addCase(processSyncQueue.rejected, (state, action) => {
        if (action.meta.requestId && state.requests?.processSyncQueue !== action.meta.requestId) return;
        state.syncStatus = 'error';
        state.syncError = action.payload;
      });
  },
});

export const {
  toggleShowTodayOnly,
  setShowTodayOnly,
  markDeliveryCompleted,
  clearCompletedDeliveries,
  clearError,
  setSyncQueue,
  recordQueuedAction,
  clearSyncError,
} = deliveriesSlice.actions;

export default deliveriesSlice.reducer;
