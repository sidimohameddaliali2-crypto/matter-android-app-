// Global Jest setup for native modules that need a mock in every test run,
// regardless of which screen/service a given test actually exercises
// (AsyncStorage is pulled in transitively by several services).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
