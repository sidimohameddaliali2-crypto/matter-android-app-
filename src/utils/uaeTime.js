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
  const a = getUAEDate(new Date(dateString));
  const b = getUAEDate(compareDate);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const isTodayUAE = (dateString) => isSameUAEDay(dateString, new Date());

export default { getUAEDate, isSameUAEDay, isTodayUAE };
