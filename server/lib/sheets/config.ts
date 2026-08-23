/**
 * Form IDs that allow registration without Discourse login.
 * Keep in sync with FormConfig.allowGuestRegistration in src/config/forms.ts.
 */
export const GUEST_REGISTRATION_FORM_IDS = new Set([
  "city-meetup-august-30",
  "city-meetup-august-2",
  "city-meetup-july-4",
]);

/** formId → sheetTab for guest-allowed forms (server trust boundary). */
export const GUEST_FORM_SHEET_TABS: Record<string, string> = {
  "city-meetup-august-30": "August 30 Entries",
  "city-meetup-august-2": "August 2 Entries",
  "city-meetup-july-4": "July 4 Entries",
};

/** formId → sheetTab for all forms (keep in sync with src/config/forms.ts). */
export const FORM_ID_SHEET_TABS: Record<string, string> = {
  "perseids-2026": "Perseids Entries",
  "city-meetup-august-30": "August 30 Entries",
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
  "August 30 Entries": 33,
  "August 2 Entries": 23,
  "July 4 Entries": 23,
  "June 13 Entries": 20,
  "May 31 Entries": 15,
};

/**
 * Form IDs that allow closed/full bypass via REGISTRATION_WHITELISTS env.
 * Keep in sync with FormConfig.allowsRegistrationWhitelist in src/config/forms.ts.
 * Env entries for other formIds are ignored (server trust boundary).
 */
export const WHITELIST_REGISTRATION_FORM_IDS = new Set(["perseids-2026"]);

/**
 * Whitelist forms that may submit as guest without a payment hold.
 * Must only include forms that do not require payment.
 * Keep in sync with FormConfig.requiresPayment === false for those ids.
 */
export const WHITELIST_UNPAID_FORM_IDS = new Set(["perseids-2026"]);

/**
 * Emails/phones allowed past closed windows or capacity.
 * Loaded from server-only env `REGISTRATION_WHITELISTS` (never commit real values).
 *
 * Example:
 * REGISTRATION_WHITELISTS={"perseids-2026":{"emails":["a@test.com"],"phones":["9xxxx"]}}
 */
export interface RegistrationWhitelist {
  emails?: string[];
  phones?: string[];
}

function parseRegistrationWhitelists(): Record<string, RegistrationWhitelist> {
  const raw = process.env.REGISTRATION_WHITELISTS?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, RegistrationWhitelist> = {};
    for (const [formId, value] of Object.entries(parsed)) {
      if (!WHITELIST_REGISTRATION_FORM_IDS.has(formId)) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const emails = Array.isArray(entry.emails)
        ? entry.emails.filter((e): e is string => typeof e === "string")
        : [];
      const phones = Array.isArray(entry.phones)
        ? entry.phones.filter((p): p is string => typeof p === "string")
        : [];
      if (emails.length > 0 || phones.length > 0) {
        out[formId] = { emails, phones };
      }
    }
    return out;
  } catch {
    console.error("[config] Invalid REGISTRATION_WHITELISTS JSON");
    return {};
  }
}

let cachedWhitelists: Record<string, RegistrationWhitelist> | null = null;

export function registrationWhitelistForForm(
  formId: string
): RegistrationWhitelist | undefined {
  if (!cachedWhitelists) cachedWhitelists = parseRegistrationWhitelists();
  const key = formId.trim();
  if (!key || !WHITELIST_REGISTRATION_FORM_IDS.has(key)) return undefined;
  return cachedWhitelists[key];
}

export function isWhitelistUnpaidForm(formId: string): boolean {
  return WHITELIST_UNPAID_FORM_IDS.has(formId.trim());
}

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
