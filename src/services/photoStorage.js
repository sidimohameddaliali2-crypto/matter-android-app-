import * as FileSystem from 'expo-file-system';

// Keep URI-only proof photos out of the cache so offline delivery sync can
// still upload them after the OS evicts camera/manipulator temporary files.
const directory = `${FileSystem.documentDirectory}delivery-photos/`;
export async function persistProofPhoto(uri) {
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return { uri: destination };
}

export async function deletePhotoFile(uri) {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
