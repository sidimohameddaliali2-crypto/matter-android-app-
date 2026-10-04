import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { driverService } from '../services/driverService';
import { deliveryService } from '../services/deliveryService';
import { bagService } from '../services/bagService';
import { offlineSyncService } from '../services/offlineSyncService';
import { parseDeliveryResponse, attachDisplayStatus } from '../services/deliveryParser';

// Async thunks
export const fetchDriverDeliveries = createAsyncThunk(
  'deliveries/fetchDriverDeliveries',
  async (driverId, { rejectWithValue }) => {
    try {
      const response = await driverService.getTodayDeliveries(driverId);
      const { deliveries: rawDeliveries, meta } = parseDeliveryResponse(response);
      const deliveriesArray = Array.isArray(rawDeliveries) ? rawDeliveries : [];
      const deliveries = deliveriesArray.map(attachDisplayStatus);
      return { deliveries, meta };
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
      await offlineSyncService.addToSyncQueue(deliveryId, 'completeDelivery', {
        status: 'delivered',
        proof,
        photoUrl,
        ...(bagId && { bagId }),
        ...(location && { location })
      });
      return rejectWithValue(error.response?.data?.message || 'Failed to complete delivery');
    }
  }
);

// UPDATE DELIVERY STATUS - generic status transition (e.g. reporting a
// failed stop, or retrying one back to pending)
export const updateDeliveryStatus = createAsyncThunk(
  'deliveries/updateStatus',
  async ({ deliveryId, status, proof }, { rejectWithValue }) => {
    try {
      const response = await deliveryService.updateDeliveryStatus(deliveryId, status, proof);
      return response;
    } catch (error) {
      await offlineSyncService.addToSyncQueue(deliveryId, 'updateStatus', { status, proof });
      return rejectWithValue(error.response?.data?.message || 'Failed to update delivery status');
    }
  }
);

// RETURN BAG - submit bag return
export const returnBag = createAsyncThunk(
  'deliveries/returnBag',
  async ({ bagId, notes, photoUrl }, { rejectWithValue }) => {
    try {
      const response = await bagService.returnBag(bagId, notes, photoUrl);
      return response;
    } catch (error) {
      await offlineSyncService.addToSyncQueue(bagId, 'returnBag', { bagId, notes, photoUrl });
      return rejectWithValue(error.response?.data?.message || 'Failed to return bag');
    }
  }
);

// PROCESS SYNC QUEUE - sync all pending operations
export const processSyncQueue = createAsyncThunk(
  'deliveries/processSyncQueue',
  async (_, { rejectWithValue }) => {
    try {
      const result = await offlineSyncService.processSyncQueue();
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
    clearSyncError: (state) => {
      state.syncError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch today's deliveries
      .addCase(fetchDriverDeliveries.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDriverDeliveries.fulfilled, (state, action) => {
        state.loading = false;
        state.deliveries = action.payload.deliveries;
        state.meta = action.payload.meta;
      })
      .addCase(fetchDriverDeliveries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch all deliveries
      .addCase(fetchAllDeliveries.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllDeliveries.fulfilled, (state, action) => {
        state.loading = false;
        state.allDeliveries = action.payload.deliveries;
        state.meta = action.payload.meta;
      })
      .addCase(fetchAllDeliveries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch delivery history
      .addCase(fetchDeliveryHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDeliveryHistory.fulfilled, (state, action) => {
        state.loading = false;
        state.history = action.payload;
      })
      .addCase(fetchDeliveryHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Complete delivery
      .addCase(completeDelivery.pending, (state) => {
        state.syncStatus = 'syncing';
      })
      .addCase(completeDelivery.fulfilled, (state, action) => {
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(completeDelivery.rejected, (state, action) => {
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Update delivery status (fail / retry)
      .addCase(updateDeliveryStatus.pending, (state) => {
        state.syncStatus = 'syncing';
      })
      .addCase(updateDeliveryStatus.fulfilled, (state) => {
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(updateDeliveryStatus.rejected, (state, action) => {
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Return bag
      .addCase(returnBag.pending, (state) => {
        state.syncStatus = 'syncing';
      })
      .addCase(returnBag.fulfilled, (state, action) => {
        state.syncStatus = 'idle';
        state.syncError = null;
      })
      .addCase(returnBag.rejected, (state, action) => {
        state.syncStatus = 'error';
        state.syncError = action.payload;
      })
      // Process sync queue
      .addCase(processSyncQueue.pending, (state) => {
        state.syncStatus = 'syncing';
      })
      .addCase(processSyncQueue.fulfilled, (state, action) => {
        state.syncStatus = 'idle';
        state.syncError = null;
        state.syncQueue = action.payload;
      })
      .addCase(processSyncQueue.rejected, (state, action) => {
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
  clearSyncError,
} = deliveriesSlice.actions;

export default deliveriesSlice.reducer;
