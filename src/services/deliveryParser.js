// Unified delivery response parser
// Normalizes varied API shapes into a simple array plus metadata

export function parseDeliveryResponse(raw) {
  const meta = {
    rawType: typeof raw,
    isArray: Array.isArray(raw),
    keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
    originalLength: 0,
    normalizedLength: 0,
    pathMatched: null,
    pagination: null,
  };

  let deliveries = [];

  try {
    if (Array.isArray(raw)) {
      deliveries = raw;
      meta.pathMatched = 'rootArray';
    } else if (raw && typeof raw === 'object') {
      if (raw.success && raw.data) {
        if (Array.isArray(raw.data.deliveries)) {
          deliveries = raw.data.deliveries;
          meta.pathMatched = 'data.deliveries';
          meta.pagination = raw.data.pagination || null;
        } else if (Array.isArray(raw.data)) {
          deliveries = raw.data;
          meta.pathMatched = 'data';
        } else if (Array.isArray(raw.deliveries)) {
          deliveries = raw.deliveries;
          meta.pathMatched = 'deliveries';
        }
      } else {
        if (Array.isArray(raw.deliveries)) {
          deliveries = raw.deliveries;
          meta.pathMatched = 'deliveries';
        } else if (raw.data && Array.isArray(raw.data.deliveries)) {
          deliveries = raw.data.deliveries;
          meta.pathMatched = 'data.deliveries';
          meta.pagination = raw.data.pagination || null;
        } else if (Array.isArray(raw.data)) {
          deliveries = raw.data;
          meta.pathMatched = 'data';
        }
      }
    }
  } catch (err) {
    meta.error = err.message;
  }

  meta.originalLength = meta.normalizedLength = deliveries.length;
  return { deliveries, meta };
}

export function attachDisplayStatus(delivery) {
  // Handle both single delivery and array
  if (Array.isArray(delivery)) {
    return delivery.map(d => ({ ...d, displayStatus: normalizeStatus(d) }));
  }
  return { ...delivery, displayStatus: normalizeStatus(delivery) };
}

function normalizeStatus(delivery) {
  const statusField = delivery?.status;
  const deliveryStatusField = delivery?.deliveryStatus;
  const stateField = delivery?.state;
  const progressField = delivery?.progress;
  
  const rawStatus = (
    statusField ||
    deliveryStatusField ||
    stateField ||
    progressField ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  // Checked before the 'deliver' bucket below on purpose: a raw value like
  // "delivery_failed" or "delivery_cancelled" contains the substring
  // "deliver" too, and would otherwise be misreported as a successful
  // delivery.
  if (
    rawStatus.includes('cancel') ||
    rawStatus.includes('fail') ||
    rawStatus.includes('void') ||
    rawStatus.includes('reject')
  ) {
    return 'cancelled';
  }

  if (
    rawStatus.includes('deliver') ||
    rawStatus.includes('complete') ||
    rawStatus.includes('done')
  ) {
    return 'delivered';
  }

  if (
    rawStatus.includes('in-progress') ||
    rawStatus.includes('in progress') ||
    rawStatus.includes('enroute') ||
    rawStatus.includes('onroute') ||
    rawStatus.includes('picked') ||
    rawStatus.includes('out')
  ) {
    return 'pending';
  }

  return 'pending';
}
