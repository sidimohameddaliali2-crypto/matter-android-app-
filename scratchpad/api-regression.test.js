import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { registerUnauthorizedHandler } from '../src/services/api';

let mockRequest;
let mockRejectResponse;
jest.mock('axios', () => ({
  create: () => ({
    interceptors: {
      request: { use: request => { mockRequest = request; } },
      response: { use: (_success, failure) => { mockRejectResponse = failure; } },
    },
  }),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
beforeEach(async () => { await AsyncStorage.clear(); registerUnauthorizedHandler(null); });

test('requests capture session identity and bearer header', async () => {
  await AsyncStorage.setItem('token', 'current-token');
  const config = await mockRequest({ method: 'get', headers: {}, baseURL: 'https://test.invalid', url: '/deliveries' });
  expect(config.headers.Authorization).toBe('Bearer current-token');
  expect(config.sessionToken).toBe('current-token');
});
test('replay retains explicitly captured token instead of borrowing a new login', async () => {
  await AsyncStorage.setItem('token', 'new-token');
  const config = await mockRequest({ method: 'post', headers: { Authorization: 'Bearer old-token' }, baseURL: 'https://test.invalid', url: '/deliveries/a/complete' });
  expect(config.headers.Authorization).toBe('Bearer old-token');
  expect(config.sessionToken).toBe('old-token');
});
test('late 401 from old session cannot sign out current user', async () => {
  await AsyncStorage.setItem('token', 'new-token');
  const logout = jest.fn();
  registerUnauthorizedHandler(logout);
  const error = { response: { status: 401 }, config: { sessionToken: 'old-token' } };
  await expect(mockRejectResponse(error)).rejects.toBe(error);
  expect(logout).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('token')).toBe('new-token');
});
test('current session 401 signs out once', async () => {
  await AsyncStorage.setItem('token', 'current-token');
  const logout = jest.fn().mockResolvedValue();
  registerUnauthorizedHandler(logout);
  const error = { response: { status: 401 }, config: { sessionToken: 'current-token' } };
  await expect(mockRejectResponse(error)).rejects.toBe(error);
  expect(logout).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('token')).toBeNull();
});
test('network errors preserve their metadata for retry classification', async () => {
  const error = Object.assign(new Error('timeout'), { code: 'ECONNABORTED', config: { url: '/deliveries' } });
  await expect(mockRejectResponse(error)).rejects.toBe(error);
  expect(error.code).toBe('ECONNABORTED');
  expect(error.message).toContain('Network error');
});
