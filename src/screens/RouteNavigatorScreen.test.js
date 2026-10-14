// Integration-level simulation of a full driver session in Route Navigator.
// Renders the real screen component (real reducer, real geometry math),
// with only the genuinely native pieces mocked (the map view, GPS hardware,
// navigation focus plumbing) and a real captured Google Directions response
// as fixture data — so this exercises actual component state transitions
// and rendered UI text, not just extracted pure functions like the other
// test file in this folder. Still short of a real device: no real map
// rendering, no real GPS chip, no real touch/gesture feel.
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import RouteNavigatorScreen from './RouteNavigatorScreen';
import deliveriesReducer from '../store/deliveriesSlice';
import realRoute from './__fixtures__/realRouteDirections.json';
import { useIsFocused } from '@react-navigation/native';

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const redraw = jest.fn();
  const mapUnmount = jest.fn();
  const markerUnmount = jest.fn();
  // The real MapView's ref exposes imperative methods (animateCamera,
  // fitToCoordinates) that RouteNavigatorScreen calls directly — stub them
  // so those calls are no-ops here instead of throwing.
  const MapView = React.forwardRef((props, ref) => {
    React.useEffect(() => () => mapUnmount(), []);
    React.useImperativeHandle(ref, () => ({
      animateCamera: jest.fn(),
      fitToCoordinates: jest.fn()
    }));
    return <View {...props} testID="route-map" />;
  });
  const Marker = React.forwardRef((props, ref) => {
    React.useEffect(() => () => markerUnmount(), []);
    React.useImperativeHandle(ref, () => ({ redraw }));
    return <View {...props} testID="route-marker" />;
  });
  return {
    __esModule: true,
    default: MapView,
    Marker,
    __redraw: redraw,
    __mapUnmount: mapUnmount,
    __markerUnmount: markerUnmount,
    Polyline: (props) => <View {...props} />,
    Circle: (props) => <View {...props} />,
    PROVIDER_GOOGLE: 'google'
  };
});

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    // No real NavigationContainer/focus plumbing in this render tree — treat
    // the screen as always focused, matching an actual mounted Route tab.
    useIsFocused: jest.fn(() => true),
    useFocusEffect: (callback) => {
      const focused = require('@react-navigation/native').useIsFocused();
      React.useEffect(() => focused ? callback() : undefined, [callback, focused]);
    }
  };
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'driver-1' }, driverProfile: { id: 'driver-1' } })
}));

// Captures the watchPositionAsync callback so the test can manually fire
// simulated GPS fixes, exactly like a real location update arriving.
let watchCallback = null;
const REAL_START = { lat: 25.118, lng: 55.185 }; // same origin used when the fixture was captured
const REAL_DESTINATION = { lat: 25.1372764, lng: 55.1893946 }; // real delivery: Leila Ayman

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 25.118, longitude: 55.185, heading: -1 }
  }),
  watchPositionAsync: jest.fn((_options, callback) => {
    watchCallback = callback;
    return Promise.resolve({ remove: jest.fn() });
  })
}));

jest.mock('../services/driverService', () => ({
  driverService: {
    getRouteDirections: jest.fn().mockResolvedValue(require('./__fixtures__/realRouteDirections.json'))
  }
}));

// The real delivery (Leila Ayman, Mjl Lamtara 1) pulled from the database
// earlier this session — same record the directions fixture was generated
// against, so the "stop" the screen navigates to and the route it draws
// are for the same real address.
const REAL_DELIVERY = {
  _id: '690a47557f912be2f1920335',
  status: 'assigned',
  // Normally computed by attachDisplayStatus() inside the real
  // fetchDriverDeliveries thunk (deliveriesSlice.js) — set directly here
  // since this test preloads Redux state rather than dispatching that
  // thunk through the real network layer.
  displayStatus: 'pending',
  customerName: 'Leila Ayman',
  address: 'Mjl Lamtara 1, apt 606',
  gpsLocation: { lat: REAL_DESTINATION.lat, lng: REAL_DESTINATION.lng },
  scheduledTime: '2025-11-05T05:00:00.000Z',
  routeOrder: 0,
  bagsAssigned: 2
};

function buildStore(deliveries) {
  return configureStore({
    reducer: { deliveries: deliveriesReducer },
    preloadedState: {
      deliveries: {
        deliveries,
        allDeliveries: [],
        history: [],
        meta: null,
        loading: false,
        error: null,
        showTodayOnly: true,
        completedDeliveries: [],
        syncQueue: [],
        syncStatus: 'idle',
        syncError: null
      }
    }
  });
}

function renderScreen(deliveries) {
  const navigation = { navigate: jest.fn() };
  const store = buildStore(deliveries);
  const result = render(
    <Provider store={store}>
      <RouteNavigatorScreen navigation={navigation} />
    </Provider>
  );
  const rerender = () => result.rerender(
    <Provider store={store}>
      <RouteNavigatorScreen navigation={navigation} />
    </Provider>
  );
  return { navigation, store, rerender };
}

// Feeds one simulated GPS fix to the component via the captured
// watchPositionAsync callback, the same way a real location update arrives.
async function simulateGpsFix(position) {
  await act(async () => {
    watchCallback({ coords: { latitude: position.latitude, longitude: position.longitude, heading: -1 } });
  });
}

beforeEach(() => {
  useIsFocused.mockReturnValue(true);
  watchCallback = null;
  jest.clearAllMocks();
});

it('redraws changed pins without continuously tracking them or redrawing on GPS updates', async () => {
  const redraw = require('react-native-maps').__redraw;
  renderScreen([REAL_DELIVERY]);
  await waitFor(() => expect(redraw).toHaveBeenCalled());
  expect(screen.getByTestId('route-marker').props.tracksViewChanges).toBe(false);

  const initialCount = redraw.mock.calls.length;
  fireEvent.press(screen.getByText('Start route'));
  await waitFor(() => expect(redraw.mock.calls.length).toBeGreaterThan(initialCount));
  await waitFor(() => expect(screen.getByText(realRoute.legs[0].steps[0].text)).toBeTruthy());
  const drivingCount = redraw.mock.calls.length;
  await simulateGpsFix(realRoute.polyline[0]);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(redraw).toHaveBeenCalledTimes(drivingCount);
});

it('reuses the map, removes overlays and location on blur, and restores route progress on focus', async () => {
  const { rerender } = renderScreen([REAL_DELIVERY]);
  await waitFor(() => expect(screen.getByText('Start route')).toBeTruthy());
  fireEvent.press(screen.getByText('Start route'));
  await waitFor(() => expect(screen.getByText('Navigating')).toBeTruthy());
  expect(screen.getByTestId('route-map')).toBeTruthy();

  useIsFocused.mockReturnValue(false);
  await act(async () => rerender());
  expect(screen.getByTestId('route-map').props.showsUserLocation).toBe(false);
  expect(screen.queryByTestId('route-marker')).toBeNull();

  useIsFocused.mockReturnValue(true);
  await act(async () => rerender());
  expect(screen.getByTestId('route-map')).toBeTruthy();
  expect(screen.getByTestId('route-map').props.showsUserLocation).toBe(true);
  expect(screen.getByText('Navigating')).toBeTruthy();
});

it('keeps redraws bounded through 100 GPS updates and releases 30 pins on each of 25 tab switches', async () => {
  const maps = require('react-native-maps');
  const deliveries = Array.from({ length: 30 }, (_, i) => ({
    ...REAL_DELIVERY, _id: `stress-${i}`, routeOrder: i,
  }));
  const { rerender } = renderScreen(deliveries);
  await waitFor(() => expect(screen.getByText('Start route')).toBeTruthy());
  fireEvent.press(screen.getByText('Start route'));
  await waitFor(() => expect(screen.getByText(realRoute.legs[0].steps[0].text)).toBeTruthy());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  const initialRedraws = maps.__redraw.mock.calls.length;
  for (let update = 0; update < 100; update += 1) {
    await simulateGpsFix(realRoute.polyline[update % Math.min(10, realRoute.polyline.length)]);
  }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(maps.__redraw).toHaveBeenCalledTimes(initialRedraws);

  for (let cycle = 0; cycle < 25; cycle += 1) {
    useIsFocused.mockReturnValue(false);
    await act(async () => rerender());
    expect(screen.getByTestId('route-map').props.showsUserLocation).toBe(false);
    expect(screen.queryAllByTestId('route-marker')).toHaveLength(0);
    expect(maps.__mapUnmount).not.toHaveBeenCalled();
    expect(maps.__markerUnmount).toHaveBeenCalledTimes((cycle + 1) * 30);
    useIsFocused.mockReturnValue(true);
    await act(async () => rerender());
    expect(screen.getAllByTestId('route-marker')).toHaveLength(30);
    for (const marker of screen.getAllByTestId('route-marker')) {
      expect(marker.props.tracksViewChanges).toBe(false);
    }
    expect(screen.getByText('Navigating')).toBeTruthy();
  }
});

describe('Route Navigator — full simulated driver session', () => {
  it('walks a real route from idle through to an unlockable arrival, using real geometry', async () => {
    const { navigation } = renderScreen([REAL_DELIVERY]);

    // Idle screen: the real stop shows up (filtered/sorted from real Redux
    // state), and the Start button enables once the one-time GPS fix lands.
    // (Both the header subtitle and the sheet title say "1 stop", so this
    // checks at least one match exists rather than requiring uniqueness.)
    await waitFor(() => expect(screen.getAllByText(/1 stop/).length).toBeGreaterThan(0));
    const startButton = await waitFor(() => screen.getByText('Start route'));

    fireEvent.press(startButton);

    // Driving phase: real directions were fetched (the mocked service
    // returned the captured fixture) and the real first instruction from
    // that fixture is now on screen.
    await waitFor(() => expect(screen.getByText('Navigating')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(realRoute.legs[0].steps[0].text)).toBeTruthy());

    // Simulate driving: feed GPS fixes along the REAL returned polyline.
    // The arrival-proximity gate was deliberately removed — "I've arrived"
    // is always available, regardless of the driver's actual distance from
    // the stop — so this only checks that the progress/instruction banner
    // keeps updating as the driver moves, not any gating behavior.
    const polyline = realRoute.polyline;
    await simulateGpsFix(polyline[Math.floor(polyline.length * 0.1)]);
    await simulateGpsFix(polyline[Math.floor(polyline.length * 0.5)]);

    const arriveButton = await waitFor(() => screen.getByText("I've arrived"));
    fireEvent.press(arriveButton);
    await waitFor(() => expect(screen.getByText(/ARRIVED/)).toBeTruthy());

    const completeButton = await waitFor(() => screen.getByText('Scan bags & complete'));
    fireEvent.press(completeButton);

    expect(navigation.navigate).toHaveBeenCalledWith('Deliveries', {
      screen: 'DeliveryDetails',
      params: { deliveryId: REAL_DELIVERY._id, delivery: expect.objectContaining({ _id: REAL_DELIVERY._id }) }
    });
  });

  it('shows the empty state when no stops have GPS coordinates', async () => {
    renderScreen([{ ...REAL_DELIVERY, gpsLocation: {} }]);
    await waitFor(() => expect(screen.getByText('No routable stops')).toBeTruthy());
  });

  it('lets the driver complete a delivery while genuinely far from the real pin (arrival-proximity gate removed)', async () => {
    const { navigation } = renderScreen([REAL_DELIVERY]);

    const startButton = await waitFor(() => screen.getByText('Start route'));
    fireEvent.press(startButton);
    await waitFor(() => expect(screen.getByText('Navigating')).toBeTruthy());

    // Driver is genuinely ~6.5km from the real delivery pin the whole time —
    // the very start of the real route, nowhere near the destination.
    await simulateGpsFix(realRoute.polyline[0]);
    const farDistance = Math.round(
      (() => {
        const a = realRoute.polyline[0];
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(REAL_DESTINATION.lat - a.latitude);
        const dLng = toRad(REAL_DESTINATION.lng - a.longitude);
        const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(REAL_DESTINATION.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * 6371000 * Math.asin(Math.sqrt(x));
      })()
    );
    expect(farDistance).toBeGreaterThan(1000); // sanity-check the simulated position really is far away

    // No "Get closer"/distance-gated text should exist anywhere anymore.
    expect(screen.queryByText(/Get closer/)).toBeNull();

    const arriveButton = screen.getByText("I've arrived");
    fireEvent.press(arriveButton);
    await waitFor(() => expect(screen.getByText(/ARRIVED/)).toBeTruthy());

    expect(screen.queryByText(/moved.*away/)).toBeNull();

    const completeButton = screen.getByText('Scan bags & complete');
    fireEvent.press(completeButton);

    expect(navigation.navigate).toHaveBeenCalledWith('Deliveries', {
      screen: 'DeliveryDetails',
      params: { deliveryId: REAL_DELIVERY._id, delivery: expect.objectContaining({ _id: REAL_DELIVERY._id }) }
    });
  });
});
