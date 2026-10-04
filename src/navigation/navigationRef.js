import { createNavigationContainerRef } from '@react-navigation/native';

// Lets code outside the component tree (e.g. a notification-tap handler)
// navigate — the ref is passed to <NavigationContainer ref={navigationRef}>
// in App.js.
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
