/**
 * Apps Script fetch budget on the server (excludes Discourse verification).
 * Cold starts + sheet writes can exceed 8s; keep below Vercel maxDuration.
 */
export const SHEETS_UPSTREAM_TIMEOUT_MS = 20_000;

/** Client timeout for /api/registrations (Discourse + Sheets end-to-end). */
export const REGISTRATION_API_TIMEOUT_MS = 25_000;

/** UI safety net while the capacity check is in flight. */
export const CAPACITY_CHECK_SAFETY_MS = REGISTRATION_API_TIMEOUT_MS + 1_000;

/** Discourse user cache TTL on the server. */
export const DISCOURSE_USER_CACHE_TTL_MS = 60_000;
