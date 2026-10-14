import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import RouteNavigatorScreen from '../src/screens/RouteNavigatorScreen';
import deliveriesReducer, { fetchDriverDeliveries } from '../src/store/deliveriesSlice';
import { driverService } from '../src/services/driverService';
import realRoute from '../src/screens/__fixtures__/realRouteDirections.json';

let mockFocused = true;
let mockWatchRemove;
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ animateCamera: jest.fn(), fitToCoordinates: jest.fn() }));
    return <View {...props} />;
  }), Marker: React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ redraw: jest.fn() }));
    return <View {...props} />;
  }), Polyline: 'Polyline', PROVIDER_GOOGLE: 'google' };
});
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused, useFocusEffect: callback => require('react').useEffect(() => mockFocused ? callback() : undefined, [mockFocused, callback]) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'driver' }, driverProfile: { id: 'driver' } }) }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }), getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 25.118, longitude: 55.185 } }), watchPositionAsync: jest.fn(() => Promise.resolve({ remove: mockWatchRemove })) }));
jest.mock('../src/services/driverService', () => ({ driverService: { getTodayDeliveries: jest.fn(), getRouteDirections: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const delivery = { _id: 'a', customerName: 'Test Stop', status: 'assigned', displayStatus: 'pending', gpsLocation: { lat: 25.1372764, lng: 55.1893946 } };
function setup(data = [delivery]) {
  const initial = deliveriesReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: { deliveries: deliveriesReducer }, preloadedState: { deliveries: { ...initial, deliveries: data } } });
  const navigation = { navigate: jest.fn() };
  const tree = () => <Provider store={store}><RouteNavigatorScreen navigation={navigation} /></Provider>;
  return { ...render(tree()), tree, store };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockWatchRemove = jest.fn();
  driverService.getTodayDeliveries.mockResolvedValue([delivery]);
  driverService.getRouteDirections.mockResolvedValue(realRoute);
});

test('GPS watcher restarts after switching away and back', async () => {
  const view = setup();
  await waitFor(() => expect(Location.getCurrentPositionAsync).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Start route'));
  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1));
  mockFocused = false;
  view.rerender(view.tree());
  expect(mockWatchRemove).toHaveBeenCalledTimes(1);
  mockFocused = true;
  view.rerender(view.tree());
  await waitFor(() => expect(driverService.getTodayDeliveries).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Navigating')).toBeTruthy();
});
test('late previous-stop directions cannot overwrite current-stop route', async () => {
  const nextDelivery = { ...delivery, _id: 'b', customerName: 'Next Stop', gpsLocation: { lat: 25.14, lng: 55.20 } };
  driverService.getTodayDeliveries.mockResolvedValue([delivery, nextDelivery]);
  const resolvers = [];
  driverService.getRouteDirections.mockImplementation(() => new Promise(r => { resolvers.push(r); }));
  const view = setup([delivery, nextDelivery]);
  await waitFor(() => expect(Location.getCurrentPositionAsync).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Start route'));
  await waitFor(() => expect(resolvers).toHaveLength(1));
  act(() => view.store.dispatch(fetchDriverDeliveries.fulfilled({ deliveries: [nextDelivery], meta: null })));
  await waitFor(() => expect(resolvers).toHaveLength(2));
  const nextRoute = { ...realRoute, polyline: [{ latitude: 25.118, longitude: 55.185 }, { latitude: 25.14, longitude: 55.20 }] };
  await act(async () => resolvers[1](nextRoute));
  expect(view.UNSAFE_getByType('Polyline').props.coordinates).toEqual(nextRoute.polyline);
  await act(async () => resolvers[0](realRoute));
  expect(screen.getByText('Next Stop')).toBeTruthy();
  expect(view.UNSAFE_getByType('Polyline').props.coordinates).toEqual(nextRoute.polyline);
});
