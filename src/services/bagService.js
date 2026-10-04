import api from './api';
import { toBagResourceId } from '../utils/bagId';

export const bagService = {
  async returnBag(bagId, notes, photoUrl = null) {
    const normalizedBagId = toBagResourceId(bagId);
    const payload = { bagId: normalizedBagId, notes, ...(photoUrl && { photoUrl }) };
    const response = await api.patch(`/bags/${normalizedBagId}/return`, payload);
    return response.data;
  },

  async collectBag(bagId, qrCode = null) {
    const normalizedBagId = toBagResourceId(bagId);
    const payload = { bagId: normalizedBagId };
    if (qrCode) payload.qrCode = qrCode;
    const response = await api.post(`/bags/${normalizedBagId}/collect`, payload);
    return response.data;
  },

  async getBagDetails(bagId) {
    const normalizedBagId = toBagResourceId(bagId);
    const response = await api.get(`/bags/${normalizedBagId}`);
    return response.data?.data || response.data;
  },

  async getBagInventory() {
    const response = await api.get('/bags/inventory');
    return response.data?.data || response.data;
  },

  async assignBag(bagId, customerId, customerName, deliveryId) {
    const normalizedBagId = toBagResourceId(bagId);
    const response = await api.patch('/bags/reassign', {
      bagId: normalizedBagId,
      customerId,
      customerName,
      deliveryId,
    });
    return response.data;
  },

  async markBagAvailable(bagId) {
    const normalizedBagId = toBagResourceId(bagId);
    // There is no separate "/available" route on the server — the existing
    // "/return" route already defaults `status` to 'available' (which also
    // resets location to 'warehouse' and clears the assignment), so this
    // reuses that instead of calling a route that doesn't exist.
    const response = await api.patch(`/bags/${normalizedBagId}/return`, { status: 'available' });
    return response.data;
  }
};
