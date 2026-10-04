import { createSlice } from '@reduxjs/toolkit';

const MAX_ITEMS = 30;

// Holds the notifications received while the app is open (see
// addNotificationReceivedListener in AppNavigator.js) so the bell icon can
// show a real list, not just a count. Capped at MAX_ITEMS — this is
// in-memory only (resets on app restart), not a synced server-side inbox.
//
// Items are keyed by the notification's own `id` (Expo's
// `request.identifier`) so the same notification can be added twice —
// once when it's *received* (arrives while JS is running) and again when
// it's *tapped* (which also fires for notifications the app never saw
// arrive, e.g. the app was fully killed) — without appearing twice.
const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: {
    items: [],
  },
  reducers: {
    addNotification: {
      reducer: (state, action) => {
        const existing = state.items.find((i) => i.id === action.payload.id);
        if (existing) {
          // Already recorded (e.g. received earlier) — just reflect that
          // it's been engaged with, never downgrade read -> unread.
          existing.read = existing.read || action.payload.read;
          return;
        }
        state.items.unshift(action.payload);
        if (state.items.length > MAX_ITEMS) {
          state.items.length = MAX_ITEMS;
        }
      },
      prepare: ({ id, title, body, type, deliveryId, read }) => ({
        payload: {
          id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: title || 'Notification',
          body: body || '',
          type: type || null,
          deliveryId: deliveryId || null,
          receivedAt: Date.now(),
          read: !!read,
        },
      }),
    },
    markOneRead: (state, action) => {
      const item = state.items.find((i) => i.id === action.payload);
      if (item) item.read = true;
    },
    markAllRead: (state) => {
      state.items.forEach((i) => { i.read = true; });
    },
  },
});

export const { addNotification, markOneRead, markAllRead } = notificationsSlice.actions;
export default notificationsSlice.reducer;
