// Single source of truth for bag QR-code parsing/normalization.
//
// Bag QR codes are printed/displayed as `BAG_XXXX`, but the REST API's bag
// resource id uses `BAG-XXXX` (e.g. `/bags/BAG-0042/return`). This
// underscore<->hyphen conversion used to be reimplemented slightly
// differently in bagService, QRScannerScreen and BagReturnScreen — a drift
// risk if any one of the three fell out of sync with the others.

const sanitize = (value) => (value ?? '').toString().trim().toUpperCase();

export const isBagCode = (value) => /^BAG[-_]/.test(sanitize(value));

// Canonical REST resource id format (hyphen) — use for any bagService/API call.
export const toBagResourceId = (value) => sanitize(value).replace(/^BAG_/, 'BAG-');

// Canonical scan/display code format (underscore) — matches the literal QR text.
export const toBagScanCode = (value) => sanitize(value).replace(/^BAG-/, 'BAG_');

export default { isBagCode, toBagResourceId, toBagScanCode };
