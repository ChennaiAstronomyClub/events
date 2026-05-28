/** Per-sheet registration caps (must match apps-script/sheets-proxy.js). */
export const REGISTRATION_LIMITS: Record<string, number> = {
  "May 31 Entries": 15,
};

/** Last column for reads (form fields + payment columns). */
export const SHEET_READ_LAST_COLUMN = "O";

/** Full column read — Google returns all populated rows (dedupe must see every row). */
export function getSheetValuesRange(_sheetTab: string, tabRef: string): string {
  return `${tabRef}!A1:${SHEET_READ_LAST_COLUMN}`;
}

export const PENDING_SEAT_HOLD_MS = 5 * 60 * 1000;
export const STATUS_CACHE_TTL_MS = 10_000;
/** In-memory hold cache TTL per serverless instance (repeat reserve within window). */
export const HOLD_CACHE_TTL_MS = 30_000;

export const PAYMENT_COLUMNS = [
  "RequiresPayment",
  "PaymentStatus",
  "PaymentStatusUpdatedAt",
  "SeatStatus",
  "PaidAt",
] as const;
