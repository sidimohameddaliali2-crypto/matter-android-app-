import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import logger from '../utils/logger';

const DEFAULT_API_BASE_URL = 'https://matterapp.online/api';
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants?.expoConfig?.extra?.apiUrl ||
  DEFAULT_API_BASE_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// Registered by AuthContext so the interceptor can force a logout on 401
// without api.js importing the context (which would create a require cycle).
let unauthorizedHandler = null;
export const registerUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      logger.log('📤 API Request:', {
        method: config.method.toUpperCase(),
        url: config.baseURL + config.url,
        hasToken: !!token,
      });
    } catch (error) {
      logger.error('Error getting token:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => {
    // Special logging for deliveries endpoint
    if (response.config.url.includes('/deliveries')) {
      logger.log('📥 DELIVERIES API Response:', {
        status: response.status,
        url: response.config.url,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        keys: response.data ? Object.keys(response.data) : [],
        fullData: JSON.stringify(response.data).substring(0, 500), // First 500 chars
      });
    } else {
      logger.log('📥 API Response:', {
        status: response.status,
        url: response.config.url,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        keys: response.data ? Object.keys(response.data) : [],
      });
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Expected/handled case (no session or an expired token) — not an
      // unexpected failure, so it doesn't get logger.error's redbox-in-dev
      // treatment. AuthContext's registered handler takes care of logging
      // the user out.
      logger.log('🚫 Unauthorized - clearing token and logging out');
      AsyncStorage.removeItem('token');
      if (unauthorizedHandler) unauthorizedHandler();
      return Promise.reject(error);
    }

    if (!error.response) {
      logger.error('Network error:', error);
      return Promise.reject(new Error('Network error. Please check your connection.'));
    }

    logger.error('❌ API Error:', {
      status: error.response?.status,
      url: error.response?.config?.url,
      message: error.response?.data?.message,
    });

    return Promise.reject(error);
  }
);

export default api;
