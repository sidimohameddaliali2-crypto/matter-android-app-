import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import * as Notifications from 'expo-notifications';
import { notificationService } from '../services/notificationService';
import { navigate } from '../navigation/navigationRef';
import { addNotification } from '../store/notificationsSlice';
import logger from '../utils/logger';

// Reads the { type, deliveryId } data payload the server attaches to every
// delivery push (see pushNotificationService.js on the backend), records it
// into the notifications list (read, since the driver is engaging with it
// right now — covers the case where the app was fully killed and this tap
// is the *only* event this notification ever produces, so it must still
// end up in NotificationsModal.js) and deep links to that delivery.
// "delivery_removed" is intentionally not navigated — the driver no longer
// has that delivery, so there's nothing useful to open — but it's still
// recorded.
const buildHandleResponse = (dispatch) => (response) => {
  try {
    const request = response?.notification?.request;
    const content = request?.content;
    const data = content?.data;
    if (!data) return;

    dispatch(addNotification({
      id: request.identifier,
      title: content.title,
      body: content.body,
      type: data.type,
      deliveryId: data.deliveryId,
      read: true,
    }));

    if (!data.deliveryId || data.type === 'delivery_removed') return;

    navigate('Main', {
      screen: 'Deliveries',
      params: { screen: 'DeliveryDetails', params: { deliveryId: data.deliveryId } },
    });
  } catch (error) {
    logger.warn('⚠️ usePushNotificationDeepLink: failed to handle tap:', error?.message || error);
  }
};

// Wires up notification-tap deep linking at the app root. Mount once inside
// the NavigationContainer (and inside the Redux Provider — this dispatches).
// Returns a `checkColdStart` callback — pass it to
// <NavigationContainer onReady={checkColdStart}>, since the cold-start case
// (app was fully killed, opened by tapping the notification) needs
// `navigationRef` to actually be ready, which a plain mount effect can't
// guarantee is true yet.
export default function usePushNotificationDeepLink() {
  const dispatch = useDispatch();
  const handledColdStart = useRef(false);

  useEffect(() => {
    // Taps that happen while JS is already running (foreground or background).
    const subscription = notificationService.addNotificationResponseListener(buildHandleResponse(dispatch));
    return () => subscription.remove();
  }, [dispatch]);

  return async () => {
    if (handledColdStart.current) return;
    handledColdStart.current = true;
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response) buildHandleResponse(dispatch)(response);
  };
}
