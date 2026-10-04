// App.js
import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import usePushNotificationDeepLink from './src/hooks/usePushNotificationDeepLink';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import store from './src/store';

// Split out from App so this can call useDispatch (via
// usePushNotificationDeepLink) — it needs to be a descendant of <Provider>,
// which the root App component itself is not (App returns the Provider
// element, it isn't rendered inside one).
const AppContent = () => {
  const checkColdStartNotification = usePushNotificationDeepLink();

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} onReady={checkColdStartNotification}>
        <StatusBar style="light" />
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

export default function App() {
  // Every screen in this app uses Ionicons for its icons, and until now the
  // app relied entirely on @expo/vector-icons' own lazy internal font
  // loading (each icon component calls Font.loadAsync itself on mount).
  // That's fine in dev/Expo Go, where Metro serves the font asset on
  // demand, but drivers on real standalone release builds were seeing every
  // icon render as a blank circle — the glyph font silently never finishing
  // loading before (or ever) the icon tried to render, with no visible
  // error since there's nothing to catch. Preloading explicitly here and
  // gating the whole app's render on it removes that race entirely: by the
  // time any screen mounts, the font is guaranteed ready.
  const [iconsLoaded] = useFonts(Ionicons.font);

  if (!iconsLoaded) {
    return null;
  }

  return (
    <Provider store={store}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Provider>
  );
}
