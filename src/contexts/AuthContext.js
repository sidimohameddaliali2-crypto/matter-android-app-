import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../services/authService';
import { registerUnauthorizedHandler } from '../services/api';
import { notificationService } from '../services/notificationService';
import { pushTokenService } from '../services/pushTokenService';
import logger from '../utils/logger';
import { ReactReduxContext } from 'react-redux';
import { offlineSyncService } from '../services/offlineSyncService';

// Registers this device's Expo push token with the server. Fire-and-forget
// by design — a failure here (permission denied, simulator, network) must
// never block login or session restore. Caches the token locally so logout
// can unregister it without re-requesting permission/deriving it again.
const registerPushNotifications = async (sessionToken) => {
  try {
    const token = await notificationService.getExpoPushTokenAsync();
    if (!token) return;
    if (await AsyncStorage.getItem('token') !== sessionToken) return;
    await pushTokenService.registerPushToken(token, Platform.OS, sessionToken);
    if (await AsyncStorage.getItem('token') === sessionToken) await AsyncStorage.setItem('pushToken', token);
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
  const redux = useContext(ReactReduxContext);
  const resetSession = () => redux?.store.dispatch({ type: 'session/reset' });
  const sessionVersion = useRef(0);
  const [user, setUser] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const version = sessionVersion.current;
    let token;
    let cached;
    try {
      token = await AsyncStorage.getItem('token');
      if (token) {
        const snapshot = await AsyncStorage.getItem('authSession');
        cached = snapshot ? JSON.parse(snapshot) : null;
        if (cached?.token !== token) cached = null;
        const response = await authService.getMe();
        if (version !== sessionVersion.current) return;
        const userData = response.data || response;
        if (!userData.user) throw new Error('Session response is missing the user');
        await offlineSyncService.configureAccount(userData.user.id || userData.user._id);
        await AsyncStorage.setItem('authSession', JSON.stringify({ token, ...userData }));
        logger.log('✅ Auth check - userData:', JSON.stringify(userData, null, 2));
        setUser(userData.user);
        setDriverProfile(userData.driverProfile);
        registerPushNotifications(token);
      }
    } catch (error) {
      if (version !== sessionVersion.current) return;
      // A 401 here just means "no valid session" — expected on first launch
      // or after a token expires, not an unexpected failure worth an error log.
      if (error.response?.status === 401) {
        logger.log('No valid session found, showing login.');
        await AsyncStorage.multiRemove(['token', 'authSession']);
        await offlineSyncService.configureAccount(null);
        resetSession();
        setUser(null);
        setDriverProfile(null);
      } else {
        logger.error('Auth check failed:', error);
        // Only a server authentication rejection invalidates a session.
        // A matching saved snapshot lets a driver keep working offline.
        if (cached?.user) {
          await offlineSyncService.configureAccount(cached.user.id || cached.user._id);
          setUser(cached.user);
          setDriverProfile(cached.driverProfile);
        }
      }
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
      if (!token || !user || !(user.id || user._id)) throw new Error('Login response is incomplete');
      sessionVersion.current += 1;

      logger.log('🔍 Extracted token:', !!token);
      logger.log('🔍 User data:', JSON.stringify(user, null, 2));
      logger.log('🔍 Driver Profile data:', JSON.stringify(driverProfile, null, 2));
      logger.log('🔍 Driver Profile ID:', driverProfile?.id);
      logger.log('🔍 Driver Profile fields:', Object.keys(driverProfile || {}));

      await AsyncStorage.setItem('token', token);
      await AsyncStorage.setItem('authSession', JSON.stringify({ token, user, driverProfile }));
      await offlineSyncService.configureAccount(user.id || user._id);
      resetSession();
      setUser(user);
      setDriverProfile(driverProfile);
      registerPushNotifications(token);
      logger.log('✅ AuthContext: Login complete!');
      return response;
    } catch (error) {
      logger.error('❌ AuthContext: Login error:', error);
      throw error;
    }
  };

  const logout = useCallback(async () => {
    sessionVersion.current += 1;
    const version = sessionVersion.current;
    const sessionToken = await AsyncStorage.getItem('token');
    const pushToken = await AsyncStorage.getItem('pushToken');
    if (version !== sessionVersion.current) return;
    await offlineSyncService.configureAccount(null);
    await AsyncStorage.multiRemove(['token', 'authSession', 'pushToken']);
    resetSession();
    setUser(null);
    setDriverProfile(null);
    if (pushToken) {
      await pushTokenService.unregisterPushToken(pushToken, sessionToken);
    }
    authService.logout();
  }, [redux?.store]);

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
