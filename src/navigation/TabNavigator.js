import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import MatterNavIcon from '../components/MatterNavIcon';
import { colors } from '../theme/matterTheme';

// Import screens
import DashboardScreen from '../screens/DashboardScreen';
import DeliveriesScreen from '../screens/DeliveriesScreen';
import DeliveryDetailsScreen from '../screens/DeliveryDetailsScreen';
import CameraScreen from '../screens/CameraScreen';
import QRScannerScreen from '../screens/QRScannerScreen';
import ProfileScreen from '../screens/ProfileScreen';
import BagReturnScreen from '../screens/BagReturnScreen';
import RouteNavigatorScreen from '../screens/RouteNavigatorScreen';

const Tab = createBottomTabNavigator();
const DeliveryStack = createStackNavigator();

const DeliveryStackNavigator = () => (
  <DeliveryStack.Navigator screenOptions={{ headerShown: false }}>
    <DeliveryStack.Screen 
      name="DeliveriesList" 
      component={DeliveriesScreen}
    />
    <DeliveryStack.Screen 
      name="DeliveryDetails" 
      component={DeliveryDetailsScreen}
    />
    <DeliveryStack.Screen 
      name="Camera" 
      component={CameraScreen}
    />
    <DeliveryStack.Screen 
      name="QRScanner" 
      component={QRScannerScreen}
    />
  </DeliveryStack.Navigator>
);

const BASE_TAB_BAR_STYLE = {
  height: 82,
  paddingTop: 8,
  paddingBottom: 10,
  backgroundColor: colors.bgAlt,
  borderTopColor: colors.border,
  borderTopWidth: 1,
};

const shouldHideTabBar = (route) => {
  const routeName = getFocusedRouteNameFromRoute(route) || 'DeliveriesList';
  return routeName === 'Camera' || routeName === 'QRScanner';
};

const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color }) => {
          let iconName;

          if (route.name === 'Dashboard') {
            iconName = 'dashboard';
          } else if (route.name === 'Deliveries') {
            iconName = 'delivery';
          } else if (route.name === 'Profile') {
            iconName = 'profile';
          } else if (route.name === 'BagReturn') {
            iconName = 'returns';
          } else if (route.name === 'Route') {
            iconName = 'route';
          }

          return <MatterNavIcon name={iconName} size={22} color={color} />;
        },
        tabBarActiveTintColor: colors.lime,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: BASE_TAB_BAR_STYLE,
        tabBarItemStyle: {
          paddingVertical: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
          letterSpacing: 0.2,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: 'Dashboard' }}
      />
      <Tab.Screen
        name="Deliveries"
        component={DeliveryStackNavigator}
        options={({ route }) => ({
          tabBarLabel: 'Delivery',
          tabBarStyle: shouldHideTabBar(route)
            ? { ...BASE_TAB_BAR_STYLE, display: 'none' }
            : BASE_TAB_BAR_STYLE,
        })}
      />
      <Tab.Screen
        name="BagReturn"
        component={BagReturnScreen}
        options={{ tabBarLabel: 'Return Bag' }}
      />
      <Tab.Screen
        name="Route"
        component={RouteNavigatorScreen}
        options={{ tabBarLabel: 'Route' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;
