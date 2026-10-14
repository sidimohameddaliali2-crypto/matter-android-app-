import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import logger from '../utils/logger';

const getPhotoAsset = (photoInput) => {
  if (!photoInput) {
    return null;
  }

  if (typeof photoInput === 'string') {
    if (photoInput.startsWith('file://') || photoInput.startsWith('content://')) {
      return {
        uri: photoInput,
        name: 'delivery-photo.jpg',
        type: 'image/jpeg',
      };
    }

    if (photoInput.startsWith('data:image/')) {
      return photoInput;
    }

    return null;
  }

  if (typeof photoInput === 'object' && typeof photoInput.uri === 'string') {
    const uri = photoInput.uri;
    const fileName = uri.split('/').pop() || 'delivery-photo.jpg';
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : 'jpg';
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

    return {
      uri,
      name: photoInput.fileName || fileName,
      type: photoInput.type || mimeType,
    };
  }

  return null;
};

export const deliveryService = {
  // DELIVERY RETRIEVAL
  async getDeliveries(params = {}) {
    const response = await api.get('/deliveries', { params });
    // Handle both success wrapped and direct data responses
    return response.data?.data || response.data;
  },

  async getDelivery(id) {
    const response = await api.get(`/deliveries/${id}`);
    // Handle both success wrapped and direct data responses
    const payload = response.data?.data || response.data;
    // The server nests the delivery (plus any bags) as { delivery, bags } —
    // unwrap so callers get a flat delivery object, not that wrapper.
    return payload?.delivery || payload;
  },

  // Driver acknowledges the "changed since assignment" banner, clearing it.
  async acknowledgeChange(id) {
    const response = await api.patch(`/deliveries/${id}/acknowledge-change`);
    return response.data?.data?.delivery || response.data;
  },

  // DELIVERY STATUS UPDATES
  async completeDelivery(id, data) {
    logger.log('📤 Submitting delivery completion:', {
      deliveryId: id,
      proof: data.proof,
      status: data.status
    });
    const response = await api.post(`/deliveries/${id}/complete`, data);
    return response.data;
  },

  async updateDeliveryStatus(id, status, proof = null, bagId = null) {
    if (status === 'delivered') {
      return this.completeDelivery(id, {
        status,
        ...(proof && { proof }),
        ...(bagId && { bagId })
      });
    }

    const payload = {
      status,
      ...(proof && { proof }),
      ...(bagId && { bagId })
    };
    
    logger.log('📤 Updating delivery status:', {
      deliveryId: id,
      payload
    });
    
    const response = await api.put(`/deliveries/${id}/status`, payload);
    return response.data;
  },

  // PHOTO UPLOAD
  async uploadDeliveryPhoto(id, photoData) {
    const response = await api.post(`/deliveries/${id}/photo`, photoData);
    return response.data;
  },

  async uploadPhoto(photoInput, sessionToken) {
    const photoAsset = getPhotoAsset(photoInput);

    if (!photoAsset) {
      throw Object.assign(new Error('Invalid delivery photo format'), { retryable: false });
    }

    const formData = new FormData();
    formData.append('image', photoAsset);

    const token = sessionToken === undefined ? await AsyncStorage.getItem('token') : sessionToken;
    const uploadUrl = `${api.defaults.baseURL}/upload/delivery-photo`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/json',
      },
      body: formData,
    });

    const responseText = await response.text();
    let payload = null;

    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      throw Object.assign(new Error(payload?.message || 'Photo upload failed'), { status: response.status });
    }

    const photoUrl = payload?.url || payload?.data?.url || payload?.data?.photoUrl;
    if (typeof photoUrl !== 'string' || !photoUrl.trim()) {
      throw Object.assign(new Error('Photo upload returned no image URL. Please try again.'), { retryable: false });
    }
    return photoUrl;
  },

  // DELIVERY HISTORY - fetches completed deliveries with date filtering
  async getDeliveryHistory(params = {}) {
    // params: { driverId, status: 'delivered', dateFrom, dateTo }
    const response = await api.get('/deliveries', { params });
    return response.data?.data || response.data;
  },

  // TASK SPECIFIC - for bag collection tasks
  async completeBagCollectionTask(deliveryId, collectedBagIds = []) {
    const payload = {
      status: 'completed',
      bagIds: collectedBagIds
    };
    logger.log('📤 Completing bag collection task:', payload);
    const response = await api.put(`/deliveries/${deliveryId}/status`, payload);
    return response.data;
  }
};
