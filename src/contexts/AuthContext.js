import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../services/authService';
import { registerUnauthorizedHandler } from '../services/api';
import { notificationService } from '../services/notificationService';
import { pushTokenService } from '../services/pushTokenService';
import logger from '../utils/logger';

// Registers this device's Expo push token with the server. Fire-and-forget
// by design — a failure here (permission denied, simulator, network) must
// never block login or session restore. Caches the token locally so logout
// can unregister it without re-requesting permission/deriving it again.
const registerPushNotifications = async () => {
  try {
    const token = await notificationService.getExpoPushTokenAsync();
    if (!token) return;
    await pushTokenService.registerPushToken(token, Platform.OS);
    await AsyncStorage.setItem('pushToken', token);
  } catch (error) {
    logger.warn('⚠️ AuthContext: push registration failed (non-fatal):', error?.message || error);
  }
};

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const userData = await authService.getMe();
        logger.log('✅ Auth check - userData:', JSON.stringify(userData, null, 2));
        setUser(userData.user);
        setDriverProfile(userData.driverProfile);
        registerPushNotifications();
      }
    } catch (error) {
      // A 401 here just means "no valid session" — expected on first launch
      // or after a token expires, not an unexpected failure worth an error log.
      if (error.response?.status === 401) {
        logger.log('No valid session found, showing login.');
      } else {
        logger.error('Auth check failed:', error);
      }
      await AsyncStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      logger.log('🔑 AuthContext: Starting login process...');
      const response = await authService.login(email, password);
      logger.log('📦 AuthContext: Got response:', response);

      // The API returns data nested in response.data
      const { token, user, driverProfile } = response.data || response;

      logger.log('🔍 Extracted token:', !!token);
      logger.log('🔍 User data:', JSON.stringify(user, null, 2));
      logger.log('🔍 Driver Profile data:', JSON.stringify(driverProfile, null, 2));
      logger.log('🔍 Driver Profile ID:', driverProfile?.id);
      logger.log('🔍 Driver Profile fields:', Object.keys(driverProfile || {}));

      setUser(user);
      setDriverProfile(driverProfile);
      await AsyncStorage.setItem('token', token);
      registerPushNotifications();
      logger.log('✅ AuthContext: Login complete!');
      return response;
    } catch (error) {
      logger.error('❌ AuthContext: Login error:', error);
      throw error;
    }
  };

  const logout = useCallback(async () => {
    const pushToken = await AsyncStorage.getItem('pushToken');
    if (pushToken) {
      pushTokenService.unregisterPushToken(pushToken);
      await AsyncStorage.removeItem('pushToken');
    }
    setUser(null);
    setDriverProfile(null);
    await AsyncStorage.removeItem('token');
    authService.logout();
  }, []);

  // Keep a stable ref so the interceptor always calls the latest logout,
  // without re-registering (and without recreating the handler) on every render.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    registerUnauthorizedHandler(() => logoutRef.current());
    return () => registerUnauthorizedHandler(null);
  }, []);

  const value = {
    user,
    driverProfile,
    loading,
    login,
    logout,
    checkAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};