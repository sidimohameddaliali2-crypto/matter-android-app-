// Single source of truth for "what day/time is it for a UAE-based driver".
// Previously this offset math was copy-pasted (with subtle drift) into
// DashboardScreen, DeliveriesScreen, ProfileScreen and driverService.
const UAE_OFFSET_MINUTES = 4 * 60; // UTC+4

// Convert any Date into a Date whose getters read as UAE local time.
export const getUAEDate = (date = new Date()) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + UAE_OFFSET_MINUTES * 60000);
};

// Same calendar day in UAE time — used for "is this scheduled for today".
export const isSameUAEDay = (dateString, compareDate = new Date()) => {
  if (!dateString) return false;
  const a = new Date(dateString).getTime();
  const b = compareDate.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const day = epoch => new Date(epoch + UAE_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
  return day(a) === day(b);
};

export const isTodayUAE = (dateString) => isSameUAEDay(dateString, new Date());

// Dispatch makes next-day stops available after 14:00 UAE time.
export const isAvailableDeliveryDay = (dateString, now = new Date()) => {
  if (isSameUAEDay(dateString, now)) return true;
  const hour = new Date(now.getTime() + UAE_OFFSET_MINUTES * 60000).getUTCHours();
  return hour >= 14 && isSameUAEDay(dateString, new Date(now.getTime() + 86400000));
};

export default { getUAEDate, isSameUAEDay, isTodayUAE };
