/**
 * Sheets API budget on the server (excludes Discourse verification).
 * Sheet writes can exceed 8s; keep below Vercel maxDuration.
 */
export const SHEETS_UPSTREAM_TIMEOUT_MS = 20_000;

/** Client timeout for /api/registrations (Discourse + Sheets end-to-end). */
export const REGISTRATION_API_TIMEOUT_MS = 25_000;

/** UI safety net while the capacity check is in flight. */
export const CAPACITY_CHECK_SAFETY_MS = REGISTRATION_API_TIMEOUT_MS + 1_000;

/** Discourse user cache TTL on the server. */
export const DISCOURSE_USER_CACHE_TTL_MS = 60_000;

/** Client timeout per calendar-invite chunk (keep below function maxDuration). */
export const CALENDAR_INVITE_API_TIMEOUT_MS = 50_000;

/** Recipients per /api/calendar-invites request so a send stays inside the function budget. */
export const CALENDAR_INVITE_CHUNK_SIZE = 25;
