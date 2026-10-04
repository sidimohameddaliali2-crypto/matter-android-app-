import { configureStore } from '@reduxjs/toolkit';
import { enableMapSet } from 'immer';
import deliveriesReducer from './deliveriesSlice';
import notificationsReducer from './notificationsSlice';

enableMapSet();

// Auth lives in AuthContext (see src/contexts/AuthContext.js), not Redux —
// there used to be a parallel authSlice here that nothing ever dispatched,
// so `state.auth` was permanently null/undefined for anything that read it.
export const store = configureStore({
  reducer: {
    deliveries: deliveriesReducer,
    notifications: notificationsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore Set objects in deliveries slice
        ignoredActions: ['deliveries/markDeliveryCompleted'],
        ignoredPaths: ['deliveries.completedDeliveries'],
      },
    }),
});

export default store;
