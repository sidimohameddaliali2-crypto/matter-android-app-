import React, { useEffect } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { useDispatch } from 'react-redux';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import TabNavigator from './TabNavigator';
import LoadingScreen from '../screens/LoadingScreen';
import { addNotification } from '../store/notificationsSlice';

const Stack = createStackNavigator();

const AppNavigator = () => {
  const { user, loading } = useAuth();
  const dispatch = useDispatch();

  // Adds a notification to the bell's list whenever one arrives while the
  // app is open (foreground/backgrounded-but-alive), unread until the
  // driver opens the bell or taps it. Keyed by the notification's own
  // `request.identifier` — usePushNotificationDeepLink uses that same id
  // when a tap is what first reveals a notification (e.g. the app was
  // fully killed and this "received" event never fired for it), so the
  // two paths dedupe into one entry instead of double-adding.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((event) => {
      const content = event?.request?.content;
      dispatch(addNotification({
        id: event?.request?.identifier,
        title: content?.title,
        body: content?.body,
        type: content?.data?.type,
        deliveryId: content?.data?.deliveryId,
      }));
    });
    return () => subscription.remove();
  }, [dispatch]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="Main" component={TabNavigator} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;