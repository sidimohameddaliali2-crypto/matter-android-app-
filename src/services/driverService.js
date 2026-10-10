import api from './api';
import logger from '../utils/logger';

const LOCAL_TZ_OFFSET_MINUTES = 240; // UTC+4 (UAE) default
const EARLY_NEXT_DAY_ENABLED = true;
const NEXT_DAY_AVAILABLE_HOUR = 14;

const getLocalDateRange = () => {
  const offsetMs = LOCAL_TZ_OFFSET_MINUTES * 60 * 1000;
  const nowUTC = new Date();
  const nowLocal = new Date(nowUTC.getTime() + offsetMs);

  const todayStringLocal = nowLocal.toISOString().split('T')[0];
  const localMidnight = new Date(`${todayStringLocal}T00:00:00.000Z`);
  const dateFrom = new Date(localMidnight.getTime() - offsetMs);
  let dateTo = new Date(dateFrom.getTime() + 24 * 60 * 60 * 1000 - 1);

  // IMPORTANT: nowLocal's epoch already encodes UAE wall-clock time as if it
  // were UTC (that's what the +offsetMs shift above is for). It must be read
  // with UTC getters here — reading with local getters would additionally
  // apply the device's own timezone offset on top, throwing this off by
  // several hours on any device not literally set to UTC+0.
  if (EARLY_NEXT_DAY_ENABLED && nowLocal.getUTCHours() >= NEXT_DAY_AVAILABLE_HOUR) {
    dateTo = new Date(dateFrom.getTime() + 48 * 60 * 60 * 1000 - 1);
  }

  return {
    nowLocal,
    todayStringLocal,
    dateFrom,
    dateTo,
  };
};

export const driverService = {
  // DRIVER PROFILE
  async getDriverProfile(id) {
    logger.log('🔄 driverService: Fetching driver profile');
    const response = await api.get(`/drivers/${id}`);
    return response.data?.data || response.data;
  },

  // DRIVER DELIVERIES - all deliveries for driver
  async getDriverDeliveries(id) {
    logger.log('🔄 driverService: Fetching ALL deliveries for driver:', id);
    try {
      if (!id) {
        logger.error('❌ No driver ID provided to getDriverDeliveries');
        throw new Error('Driver ID is required');
      }
      
      const response = await api.get('/deliveries', { params: { driverId: id } });
      logger.log('✅ /deliveries with driverId filter success');
      logger.log('📦 Response data:', response.data);
      return response.data?.data || response.data;
    } catch (err) {
      logger.error('❌ Failed to fetch driver deliveries:', err.message);
      logger.error('❌ Error details:', err.response?.data || err);
      throw err;
    }
  },

  // TODAY'S DELIVERIES - filtered for today
  async getTodayDeliveries(driverId) {
    logger.log('🔄 driverService: Fetching today deliveries for driver:', driverId);
    try {
      if (!driverId) {
        logger.error('❌ No driverId provided to getTodayDeliveries');
        throw new Error('Driver ID is required');
      }

      const { nowLocal, todayStringLocal, dateFrom, dateTo } = getLocalDateRange();
      logger.log('📅 Local date filter:', {
        currentTime: new Date().toLocaleTimeString('en-US', { hour12: true }),
        localTime: nowLocal.toLocaleTimeString('en-US', { hour12: true }),
        targetDayString: todayStringLocal,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        LOCAL_TZ_OFFSET_MINUTES,
        EARLY_NEXT_DAY_ENABLED,
        NEXT_DAY_AVAILABLE_HOUR,
      });

      let response;
      try {
        response = await api.get('/deliveries/driver/today');
        logger.log('✅ Successfully fetched from /deliveries/driver/today endpoint');
      } catch (error) {
        logger.log('⚠️ Fallback to /deliveries endpoint with date parameters');
        response = await api.get('/deliveries', {
          params: {
            driverId: driverId,
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString(),
            limit: 5000,
          },
        });
      }
      logger.log('✅ Today deliveries fetched successfully');
      logger.log('📦 Response data:', response.data);
      return response.data?.data || response.data;
    } catch (err) {
      logger.error('❌ Failed to fetch today deliveries:', err.message);
      logger.error('❌ Error details:', err.response?.data || err);
      throw err;
    }
  },

  // DELIVERY HISTORY - completed deliveries with date filtering
  async getDeliveryHistory(driverId, { dateFrom, dateTo } = {}) {
    logger.log('🔄 driverService: Fetching delivery history');
    try {
      const params = {
        driverId,
        status: 'delivered',
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo })
      };
      const response = await api.get('/deliveries', { params });
      logger.log('✅ Delivery history fetched');
      return response.data?.data || response.data;
    } catch (err) {
      logger.error('❌ Failed to fetch delivery history:', err.message);
      throw err;
    }
  },

  // LOCATION UPDATES
  async updateDriverLocation(id, latitude, longitude) {
    logger.log('📤 driverService: Updating driver location');
    const response = await api.put(`/drivers/${id}/location`, {
      latitude,
      longitude,
      timestamp: new Date().toISOString()
    });
    return response.data;
  },

  // ROUTE DIRECTIONS - polyline + turn-by-turn steps through an ordered
  // sequence of points (driver's current position + remaining stops), for
  // the Route Navigator screen.
  async getRouteDirections(id, points) {
    logger.log('📤 driverService: Fetching route directions');
    const response = await api.post(`/drivers/${id}/route-directions`, { points });
    return response.data;
  },

  // AVAILABILITY STATUS
  async updateDriverAvailability(id, isAvailable) {
    logger.log('📤 driverService: Updating driver availability:', isAvailable);
    const response = await api.put(`/drivers/${id}/availability`, { 
      isAvailable,
      timestamp: new Date().toISOString()
    });
    return response.data;
  },

  // GET DRIVER STATISTICS
  async getDriverStats(id) {
    logger.log('🔄 driverService: Fetching driver statistics');
    const response = await api.get(`/drivers/${id}/stats`);
    return response.data?.data || response.data;
  },

  // GET PERFORMANCE METRICS
  async getPerformanceMetrics(id, timeframe = 'week') {
    logger.log('🔄 driverService: Fetching performance metrics');
    const response = await api.get(`/drivers/${id}/metrics`, {
      params: { timeframe }
    });
    return response.data?.data || response.data;
  }
};