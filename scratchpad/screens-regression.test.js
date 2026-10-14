import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeliveriesScreen from '../src/screens/DeliveriesScreen';
import DeliveryDetailsScreen from '../src/screens/DeliveryDetailsScreen';
import BagReturnScreen from '../src/screens/BagReturnScreen';
import QRScannerScreen from '../src/screens/QRScannerScreen';
import CameraScreen from '../src/screens/CameraScreen';
import LoginScreen from '../src/screens/LoginScreen';
import deliveriesReducer, { fetchDriverDeliveries } from '../src/store/deliveriesSlice';
import { driverService } from '../src/services/driverService';
import { deliveryService } from '../src/services/deliveryService';
import { bagService } from '../src/services/bagService';
import { offlineSyncService } from '../src/services/offlineSyncService';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused, useFocusEffect: callback => require('react').useEffect(callback, []) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'driver' }, driverProfile: { id: 'driver' }, login: mockLogin }) }));
jest.mock('../src/services/driverService', () => ({ driverService: { getTodayDeliveries: jest.fn() } }));
jest.mock('../src/services/deliveryService', () => ({ deliveryService: { getDelivery: jest.fn(), uploadPhoto: jest.fn(), completeDelivery: jest.fn(), updateDeliveryStatus: jest.fn() } }));
jest.mock('../src/services/bagService', () => ({ bagService: { returnBag: jest.fn() } }));
jest.mock('../src/services/notificationService', () => ({ notificationService: { requestPermissions: jest.fn(), notifyNewDeliveries: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [mockPermission, jest.fn()] }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

let mockFocused = true;
let mockPermission = { granted: true };
const mockLogin = jest.fn();
const today = new Date().toISOString();
const delivery = { _id: 'a', customer: { name: 'Test Customer', address: 'Test Street', phone: '12345' }, status: 'assigned', displayStatus: 'pending', scheduledTime: today };
const nav = () => ({ navigate: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), isFocused: () => true });
function setup(component, data = [delivery]) {
  const initial = deliveriesReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: { deliveries: deliveriesReducer }, preloadedState: { deliveries: { ...initial, deliveries: data } } });
  render(<Provider store={store}>{component}</Provider>);
  return store;
}
beforeEach(async () => {
  mockFocused = true;
  jest.clearAllMocks();
  await offlineSyncService.configureAccount(null);
  await AsyncStorage.clear();
  driverService.getTodayDeliveries.mockResolvedValue([delivery]);
  deliveryService.getDelivery.mockResolvedValue(delivery);
  deliveryService.completeDelivery.mockResolvedValue({ success: true });
  deliveryService.updateDeliveryStatus.mockResolvedValue({ success: true });
  deliveryService.uploadPhoto.mockResolvedValue('https://test.invalid/photo.jpg');
  bagService.returnBag.mockResolvedValue({ success: true });
  mockPermission = { granted: true };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('delivery list loads and opens details', async () => {
  const n = nav();
  setup(<DeliveriesScreen navigation={n} route={{ params: {} }} />);
  await waitFor(() => expect(driverService.getTodayDeliveries).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Test Customer'));
  expect(n.navigate).toHaveBeenCalledWith('DeliveryDetails', expect.objectContaining({ deliveryId: 'a' }));
});
test('search matches visible nested customer name', async () => {
  setup(<DeliveriesScreen navigation={nav()} route={{ params: {} }} />);
  await waitFor(() => expect(driverService.getTodayDeliveries).toHaveBeenCalled());
  expect(screen.getByText('Test Customer')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText(/Search by name/), 'Test Customer');
  expect(screen.getByText('Test Customer')).toBeTruthy();
});
test('completed collection is removed from active collections', async () => {
  const task = { ...delivery, type: 'Collection', status: 'completed', displayStatus: 'delivered' };
  driverService.getTodayDeliveries.mockResolvedValue([task]);
  setup(<DeliveriesScreen navigation={nav()} route={{ params: {} }} />, [task]);
  await waitFor(() => expect(driverService.getTodayDeliveries).toHaveBeenCalled());
  fireEvent.press(screen.getByText(/^Collection/));
  expect(screen.queryByText('Test Customer')).toBeNull();
});
test('tomorrow is visible alongside today after UAE 14:00', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-13T10:05:00Z'));
  const currentDelivery = { ...delivery, scheduledTime: new Date().toISOString() };
  const tomorrow = { ...delivery, _id: 'b', customer: { name: 'Tomorrow Customer' }, scheduledTime: new Date(Date.now() + 86400000).toISOString() };
  driverService.getTodayDeliveries.mockResolvedValue([currentDelivery, tomorrow]);
  setup(<DeliveriesScreen navigation={nav()} route={{ params: {} }} />, [delivery, tomorrow]);
  await waitFor(() => expect(driverService.getTodayDeliveries).toHaveBeenCalled());
  expect(screen.getByText('Tomorrow Customer')).toBeTruthy();
});
test('replay updates local delivery status', async () => {
  await offlineSyncService.addToSyncQueue('a', 'completeDeliveryWithPhoto', { photo: { uri: 'file://a.jpg' }, proof: {} });
  // Replay uses api directly; spy only its operation to avoid external traffic.
  jest.spyOn(offlineSyncService, 'syncItem').mockImplementation(async item => offlineSyncService.updateSyncItemStatus(item.id, 'synced'));
  const s = setup(<DeliveriesScreen navigation={nav()} route={{ params: {} }} />);
  await waitFor(() => expect(s.getState().deliveries.syncQueue[0]?.status).toBe('synced'));
  expect(s.getState().deliveries.deliveries[0].displayStatus).toBe('delivered');
  expect(screen.queryByText('Test Customer')).toBeNull();
});
test('delivery details start camera then QR scanner on photo return', async () => {
  const n = nav();
  const route = { params: { deliveryId: 'a', delivery } };
  const s = configureStore({ reducer: { deliveries: deliveriesReducer } });
  const { rerender } = render(<Provider store={s}><DeliveryDetailsScreen navigation={n} route={route} /></Provider>);
  await waitFor(() => expect(deliveryService.getDelivery).toHaveBeenCalled());
  fireEvent.press(screen.getAllByText('Complete Delivery').at(-1));
  expect(n.navigate).toHaveBeenCalledWith('Camera', { deliveryId: 'a', source: 'complete-delivery' });
  rerender(<Provider store={s}><DeliveryDetailsScreen navigation={n} route={{ params: { ...route.params, capturedPhoto: { uri: 'file://a.jpg' }, photoSource: 'complete-delivery' } }} /></Provider>);
  expect(n.navigate).toHaveBeenCalledWith('QRScanner', { deliveryId: 'a', mode: 'delivery' });
});
test('scanned bag completes delivery with remote photo without reupload', async () => {
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: { ...delivery, deliveryPhoto: 'https://test.invalid/photo.jpg' }, scannedBagId: 'BAG_0042' } }} />);
  await waitFor(() => expect(deliveryService.completeDelivery).toHaveBeenCalled());
  expect(deliveryService.uploadPhoto).not.toHaveBeenCalled();
  expect(deliveryService.completeDelivery).toHaveBeenCalledWith('a', expect.objectContaining({ bagId: 'BAG_0042', proof: expect.objectContaining({ images: ['https://test.invalid/photo.jpg'] }) }));
  expect(screen.getByText('Synced to ops')).toBeTruthy();
});
test('HTTP 400 displays rejection without claiming offline success', async () => {
  deliveryService.completeDelivery.mockRejectedValue({ response: { status: 400, data: { message: 'Invalid bag' } } });
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: { ...delivery, deliveryPhoto: 'https://test.invalid/photo.jpg' }, scannedBagId: 'BAG_0042' } }} />);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Delivery not saved', 'Invalid bag'));
  expect(screen.queryByText('Saved offline — will sync when back online')).toBeNull();
  expect(await offlineSyncService.getSyncQueue()).toHaveLength(0);
});
test('storage failure displays error and does not claim offline success', async () => {
  deliveryService.uploadPhoto.mockRejectedValue(new Error('offline'));
  jest.spyOn(offlineSyncService, 'addToSyncQueue').mockRejectedValue(new Error('disk full'));
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: { ...delivery, deliveryPhoto: { uri: 'file://a.jpg' } }, scannedBagId: 'BAG_0042' } }} />);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Delivery not saved', 'disk full'));
  expect(screen.queryByText('Saved offline — will sync when back online')).toBeNull();
  expect(await offlineSyncService.getSyncQueue()).toHaveLength(0);
});
test('return bags: manual entry deduplicates and calls return API', async () => {
  setup(<BagReturnScreen />);
  fireEvent.press(screen.getByText('Scan Bag QR Code'));
  fireEvent.changeText(screen.getByPlaceholderText('BAG-0'), 'BAG_0042');
  fireEvent.press(screen.getByText('Add Bag ID'));
  fireEvent.press(screen.getByText('Add Bag ID'));
  expect(Alert.alert).toHaveBeenCalledWith('Already Scanned', expect.any(String));
  fireEvent.press(screen.getByText('Done Scanning'));
  fireEvent.press(screen.getByText('Done - Return 1 Bag'));
  await waitFor(() => expect(bagService.returnBag).toHaveBeenCalledWith('BAG-0042', '', null));
});
test('scanner confirms scan without claiming completion', () => {
  jest.useFakeTimers();
  const n = nav();
  setup(<QRScannerScreen navigation={n} route={{ params: { mode: 'delivery', deliveryId: 'a' } }} />);
  fireEvent.changeText(screen.getByPlaceholderText('BAG-0'), 'BAG-0042');
  fireEvent.press(screen.getByText('Submit Code'));
  expect(screen.queryByText('Delivery completed successfully')).toBeNull();
  expect(screen.getByText('Bag scanned. Submitting delivery proof next.')).toBeTruthy();
  expect(deliveryService.completeDelivery).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1500));
  expect(n.navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { deliveryId: 'a', scannedBagId: 'BAG_0042' } }));
});
test('camera handles denied permission', () => {
  mockPermission = { granted: false, canAskAgain: false };
  setup(<CameraScreen navigation={nav()} route={{ params: {} }} />);
  expect(screen.getByText('We need your permission to use the camera')).toBeTruthy();
});
test('login prevents empty credentials', () => {
  setup(<LoginScreen />);
  fireEvent.press(screen.getByText('Sign in'));
  expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please enter both email and password');
  expect(mockLogin).not.toHaveBeenCalled();
});
test('photo upload failure saves full completion for replay', async () => {
  deliveryService.uploadPhoto.mockRejectedValue(new Error('offline'));
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: { ...delivery, deliveryPhoto: { uri: 'file://a.jpg' } }, scannedBagId: 'BAG_0042' } }} />);
  await waitFor(() => expect(screen.getByText('Saved offline — will sync when back online')).toBeTruthy());
  expect((await offlineSyncService.getSyncQueue())[0]).toEqual(expect.objectContaining({ deliveryId: 'a', action: 'completeDeliveryWithPhoto', data: expect.objectContaining({ photo: { uri: 'file://a.jpg' }, bagId: 'BAG_0042' }) }));
});
test('report failed stop sends reason and displays confirmation', async () => {
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery } }} />);
  await waitFor(() => expect(deliveryService.getDelivery).toHaveBeenCalled());
  fireEvent.press(screen.getByText("Can't deliver? Report an issue"));
  fireEvent.press(screen.getByText('Wrong location'));
  fireEvent.changeText(screen.getByPlaceholderText('Anything ops should know'), 'incorrect address');
  fireEvent.press(screen.getByText('Report failed stop'));
  await waitFor(() => expect(screen.getByText('Reported failed')).toBeTruthy());
  expect(deliveryService.updateDeliveryStatus).toHaveBeenCalledWith('a', 'cancelled', expect.objectContaining({ failReason: 'location', note: 'incorrect address' }));
});
test('failed stop retry changes status to pending', async () => {
  const failed = { ...delivery, status: 'cancelled', displayStatus: 'cancelled' };
  deliveryService.getDelivery.mockResolvedValue(failed);
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: failed } }} />);
  await waitFor(() => expect(deliveryService.getDelivery).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Retry this stop'));
  await waitFor(() => expect(deliveryService.updateDeliveryStatus).toHaveBeenCalledWith('a', 'pending', undefined));
  expect(screen.getAllByText('Complete Delivery').length).toBeGreaterThan(0);
});
test('offline bag return removes saved item and does not offer duplicate retry', async () => {
  bagService.returnBag.mockRejectedValue(new Error('offline'));
  setup(<BagReturnScreen />);
  fireEvent.press(screen.getByText('Scan Bag QR Code'));
  fireEvent.changeText(screen.getByPlaceholderText('BAG-0'), 'BAG_0042');
  fireEvent.press(screen.getByText('Add Bag ID'));
  fireEvent.press(screen.getByText('Done Scanning'));
  fireEvent.press(screen.getByText('Done - Return 1 Bag'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Saved offline', expect.any(String)));
  expect(screen.queryByText('BAG-0042')).toBeNull();
  expect(await offlineSyncService.getSyncQueue()).toHaveLength(1);
});

test('failed list fetch still attempts saved delivery replay', async () => {
  driverService.getTodayDeliveries.mockRejectedValue(new Error('list unavailable'));
  await offlineSyncService.addToSyncQueue('a', 'completeDelivery', {});
  const replay = jest.spyOn(offlineSyncService, 'syncItem').mockImplementation(async item => offlineSyncService.updateSyncItemStatus(item.id, 'synced'));
  setup(<DeliveriesScreen navigation={nav()} route={{ params: {} }} />);
  await waitFor(() => expect(replay).toHaveBeenCalled());
});
test('rejected failed-stop report does not show a success confirmation', async () => {
  deliveryService.updateDeliveryStatus.mockRejectedValue({ response: { status: 400, data: { message: 'Report rejected' } } });
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery } }} />);
  fireEvent.press(screen.getByText("Can't deliver? Report an issue"));
  fireEvent.press(screen.getByText('Wrong location'));
  fireEvent.press(screen.getByText('Report failed stop'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Report not saved', 'Report rejected'));
  expect(screen.queryByText('Reported failed')).toBeNull();
});
test('rejected retry leaves the delivery failed', async () => {
  const failed = { ...delivery, status: 'cancelled', displayStatus: 'cancelled' };
  deliveryService.getDelivery.mockResolvedValue(failed);
  deliveryService.updateDeliveryStatus.mockRejectedValue({ response: { status: 400, data: { message: 'Retry rejected' } } });
  setup(<DeliveryDetailsScreen navigation={nav()} route={{ params: { deliveryId: 'a', delivery: failed } }} />);
  fireEvent.press(screen.getByText('Retry this stop'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Retry not saved', 'Retry rejected'));
  expect(screen.getByText('Retry this stop')).toBeTruthy();
});


test('scanner releases camera and cancels pending navigation on blur', () => {
  jest.useFakeTimers();
  const n = nav();
  const store = configureStore({ reducer: { deliveries: deliveriesReducer } });
  const component = () => <Provider store={store}><QRScannerScreen navigation={n} route={{ params: { mode: 'delivery', deliveryId: 'a' } }} /></Provider>;
  const view = render(component());
  fireEvent.changeText(view.getByPlaceholderText('BAG-0'), 'BAG-0042');
  fireEvent.press(view.getByText('Submit Code'));
  mockFocused = false;
  view.rerender(component());
  expect(view.UNSAFE_queryByType('CameraView')).toBeNull();
  act(() => jest.advanceTimersByTime(1500));
  expect(n.navigate).not.toHaveBeenCalled();
});
