import * as FileSystem from 'expo-file-system';
import { persistProofPhoto, deletePhotoFile } from './photoStorage';
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file://documents/', makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(), deleteAsync: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());
test('persists a URI-only proof outside disposable cache', async () => {
  const photo = await persistProofPhoto('file://cache/proof.jpg');
  expect(photo).toEqual({ uri: expect.stringMatching(/^file:\/\/documents\/delivery-photos\/.+\.jpg$/) });
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: 'file://cache/proof.jpg', to: photo.uri });
  expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith('file://documents/delivery-photos/', { intermediates: true });
});
test('cleanup is safe for missing temporary files', async () => {
  FileSystem.deleteAsync.mockRejectedValue(new Error('already gone'));
  await expect(deletePhotoFile('file://cache/missing.jpg')).resolves.toBeUndefined();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://cache/missing.jpg', { idempotent: true });
});
