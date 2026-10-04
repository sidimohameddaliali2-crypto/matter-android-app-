import api from './api';
import logger from '../utils/logger';

// Kept separate from authService.js: this is a device-registration concern
// with different error-tolerance semantics (must never throw — a failure
// here must never block login/logout), not session/credential management.
export const pushTokenService = {
  async registerPushToken(token, platform) {
    if (!token) return;
    try {
      await api.post('/auth/push-token', { token, platform });
    } catch (error) {
      logger.warn('⚠️ pushTokenService: failed to register push token:', error?.message || error);
    }
  },

  async unregisterPushToken(token) {
    if (!token) return;
    try {
      await api.delete('/auth/push-token', { data: { token } });
    } catch (error) {
      logger.warn('⚠️ pushTokenService: failed to unregister push token:', error?.message || error);
    }
  },
};

export default pushTokenService;
