/**
 * Form IDs that allow registration without Discourse login.
 * Keep in sync with FormConfig.allowGuestRegistration in src/config/forms.ts.
 */
export const GUEST_REGISTRATION_FORM_IDS = new Set([
  "city-meetup-august-2",
  "city-meetup-july-4",
]);

/** formId → sheetTab for guest-allowed forms (server trust boundary). */
export const GUEST_FORM_SHEET_TABS: Record<string, string> = {
  "city-meetup-august-2": "August 2 Entries",
  "city-meetup-july-4": "July 4 Entries",
};

/** formId → sheetTab for all forms (keep in sync with src/config/forms.ts). */
export const FORM_ID_SHEET_TABS: Record<string, string> = {
  "perseids-2026": "Perseids Entries",
  "city-meetup-august-2": "August 2 Entries",
  "city-meetup-july-4": "July 4 Entries",
  "visual-astronomy-june-2026": "June 13 Entries",
  "city-meetup-may-31": "May 31 Entries",
  "star-party-march-2026": "Entries",
  "star-party-april-2026": "April Entries",
  "night-sky-passport-presale": "Night Sky Passport Presale Entries",
  "visual-astronomy-june-2026-backfill": "June 13 Entries",
};

export function expectedSheetTabForForm(formId: string): string | undefined {
  return FORM_ID_SHEET_TABS[formId.trim()];
}

/** Per-sheet registration caps (must match apps-script/sheets-proxy.js). */
export const REGISTRATION_LIMITS: Record<string, number> = {
  "August 2 Entries": 23,
  "July 4 Entries": 23,
  "June 13 Entries": 20,
  "May 31 Entries": 15,
};

/** Last column for reads (form fields + payment columns). Must cover the widest event tab. */
export const SHEET_READ_LAST_COLUMN = "AZ";

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
