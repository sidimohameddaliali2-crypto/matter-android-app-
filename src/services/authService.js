import api from './api';

export const authService = {
  async login(email, password) {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  async getMe() {
    const response = await api.get('/auth/me');
    return response.data;
  },

  async updateProfile(profileData) {
    const response = await api.put('/auth/profile', profileData);
    return response.data;
  },

  async changePassword(passwordData) {
    // Not currently called from any screen (no change-password UI exists
    // yet), but was pointing at a route that doesn't exist on the server
    // (server has PUT /auth/change-password, not /auth/password) — fixed
    // so this doesn't 404 the moment it's wired up.
    const response = await api.put('/auth/change-password', passwordData);
    return response.data;
  },

  async logout() {
    // Token removal is handled by the interceptor
  }
};