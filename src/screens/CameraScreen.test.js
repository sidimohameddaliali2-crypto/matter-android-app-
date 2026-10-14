import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Platform, TouchableOpacity } from 'react-native';
import CameraScreen from './CameraScreen';
import * as ImageManipulator from 'expo-image-manipulator';
import { persistProofPhoto, deletePhotoFile } from '../services/photoStorage';
import * as MediaLibrary from 'expo-media-library';

let mockFocused = true;
const mockCapture = jest.fn();
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-camera', () => ({
  CameraView: require('react').forwardRef((props, ref) => {
    require('react').useImperativeHandle(ref, () => ({ takePictureAsync: mockCapture }));
    return require('react').createElement('CameraView', props);
  }),
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), saveToLibraryAsync: jest.fn() }));
jest.mock('../services/photoStorage', () => ({ persistProofPhoto: jest.fn(), deletePhotoFile: jest.fn().mockResolvedValue() }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn() } }));

const props = () => ({ navigation: { navigate: jest.fn(), goBack: jest.fn() }, route: { params: { source: 'complete-delivery' } } });
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  Platform.OS = 'android';
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: false });
  mockCapture.mockResolvedValue({ uri: 'file://raw.jpg', width: 1600 });
  ImageManipulator.manipulateAsync.mockResolvedValue({ uri: 'file://compressed.jpg' });
  persistProofPhoto.mockResolvedValue({ uri: 'file://documents/delivery-photos/proof.jpg' });
});
function ready(view) { fireEvent(view.UNSAFE_getByType('CameraView'), 'cameraReady'); }

test('caps native resolution, stores URI-only proof and cleans both temporary files', async () => {
  const p = props(); const view = render(<CameraScreen {...p} />);
  expect(view.UNSAFE_getByType('CameraView').props.pictureSize).toBe('1600x1200');
  ready(view); fireEvent.press(view.getByLabelText('Take delivery photo'));
  await waitFor(() => expect(view.getByText('Use Photo')).toBeTruthy());
  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith('file://raw.jpg', [{ resize: { width: 1200 } }], expect.objectContaining({ base64: false }));
  expect(deletePhotoFile).toHaveBeenCalledWith('file://raw.jpg');
  expect(deletePhotoFile).toHaveBeenCalledWith('file://compressed.jpg');
  fireEvent.press(view.getByText('Use Photo'));
  expect(p.navigation.navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { capturedPhoto: { uri: 'file://documents/delivery-photos/proof.jpg' }, photoSource: 'complete-delivery' } }));
  view.unmount();
  expect(deletePhotoFile).not.toHaveBeenCalledWith('file://documents/delivery-photos/proof.jpg');
});

test('retake deletes unsubmitted proof and waits for fresh camera readiness', async () => {
  const view = render(<CameraScreen {...props()} />); ready(view);
  fireEvent.press(view.getByLabelText('Take delivery photo'));
  await waitFor(() => expect(view.getByText('Retake')).toBeTruthy());
  fireEvent.press(view.getByText('Retake'));
  expect(deletePhotoFile).toHaveBeenCalledWith('file://documents/delivery-photos/proof.jpg');
  expect(view.getByLabelText('Take delivery photo').props.accessibilityState.disabled).toBe(true);
});

test('locks overlapping captures and discards late results after blur', async () => {
  let resolve;
  mockCapture.mockReturnValue(new Promise(r => { resolve = r; }));
  const p = props(); const view = render(<CameraScreen {...p} />); ready(view);
  const press = view.UNSAFE_getAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Take delivery photo').props.onPress;
  act(() => { press(); press(); });
  expect(mockCapture).toHaveBeenCalledTimes(1);
  mockFocused = false; view.rerender(<CameraScreen {...p} />);
  expect(view.UNSAFE_queryByType('CameraView')).toBeNull();
  await act(async () => resolve({ uri: 'file://late.jpg', width: 1600 }));
  expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
  expect(deletePhotoFile).toHaveBeenCalledWith('file://late.jpg');
});

test('does not upscale a smaller sensor image', async () => {
  mockCapture.mockResolvedValue({ uri: 'file://raw.jpg', width: 800 });
  const view = render(<CameraScreen {...props()} />); ready(view);
  fireEvent.press(view.getByLabelText('Take delivery photo'));
  await waitFor(() => expect(view.getByText('Retake')).toBeTruthy());
  expect(ImageManipulator.manipulateAsync.mock.calls[0][1]).toEqual([]);
});

test('cleans a durable file created after the user has left during persistence', async () => {
  let resolve;
  persistProofPhoto.mockReturnValue(new Promise(r => { resolve = r; }));
  const p = props(); const view = render(<CameraScreen {...p} />); ready(view);
  fireEvent.press(view.getByLabelText('Take delivery photo'));
  await waitFor(() => expect(persistProofPhoto).toHaveBeenCalled());
  mockFocused = false; view.rerender(<CameraScreen {...p} />);
  await act(async () => resolve({ uri: 'file://documents/late.jpg' }));
  expect(deletePhotoFile).toHaveBeenCalledWith('file://documents/late.jpg');
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('a gallery failure still allows proof confirmation', async () => {
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: true });
  MediaLibrary.saveToLibraryAsync.mockRejectedValue(new Error('gallery unavailable'));
  const view = render(<CameraScreen {...props()} />); ready(view);
  fireEvent.press(view.getByLabelText('Take delivery photo'));
  await waitFor(() => expect(view.getByText('Use Photo')).toBeTruthy());
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file://documents/delivery-photos/proof.jpg');
});
