import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import logger from '../utils/logger';

// Configure how notifications are presented while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const notificationService = {
  /**
   * Request notification permissions from the OS.
   * Returns true if granted, false otherwise.
   */
  async requestPermissions() {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('deliveries', {
          name: 'Delivery Assignments',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
          vibrationPattern: [0, 250, 250, 250],
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus === 'granted') return true;

      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch {
      return false;
    }
  },

  /**
   * Get a real Expo push token for this device, requesting permission first.
   * Returns null on simulators/emulators or on any failure — must never
   * throw, since this is called from the login/session-restore path and a
   * push registration failure must not block authentication.
   */
  async getExpoPushTokenAsync() {
    try {
      if (!Device.isDevice) {
        logger.log('📵 notificationService: skipping push token — not a physical device');
        return null;
      }

      const granted = await this.requestPermissions();
      if (!granted) return null;

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        logger.warn('⚠️ notificationService: no EAS projectId configured, cannot get push token');
        return null;
      }

      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
      return token;
    } catch (error) {
      logger.warn('⚠️ notificationService: failed to get push token:', error?.message || error);
      return null;
    }
  },

  /**
   * Listen for the user tapping a notification (foreground or background —
   * not the cold-start case, which needs `Notifications.getLastNotificationResponseAsync()`
   * checked separately once at app start). Returns the subscription so the
   * caller can `.remove()` it.
   */
  addNotificationResponseListener(handler) {
    return Notifications.addNotificationResponseReceivedListener(handler);
  },

  /**
   * Fire a local notification when new deliveries are assigned.
   * @param {number} newCount  Number of newly added deliveries
   */
  async notifyNewDeliveries(newCount) {
    if (newCount <= 0) return;
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📦 New Delivery Assignment',
          body:
            newCount === 1
              ? 'You have 1 new delivery assigned. Tap to view.'
              : `You have ${newCount} new deliveries assigned. Tap to view.`,
          sound: 'default',
          data: { type: 'new_deliveries', count: newCount },
        },
        trigger: null, // fire immediately
      });
    } catch {
      // Notifications are non-critical — silently ignore failures
    }
  },
};
