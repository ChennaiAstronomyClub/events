/** India does not observe DST; +05:30 is always IST. */
export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

const HAS_EXPLICIT_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

const IST_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: IST_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const IST_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: IST_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/**
 * Parse a datetime string. Naive ISO (no Z/offset) is treated as IST wall time.
 * Strings that already include Z or an offset are parsed as-is.
 */
export function parseIstDateTime(iso: string): Date {
  const trimmed = iso.trim();
  if (HAS_EXPLICIT_TZ.test(trimmed)) return new Date(trimmed);
  return new Date(`${trimmed}${IST_OFFSET}`);
}

export function formatIstDateTime(iso?: string): string {
  if (!iso) return "";
  return parseIstDateTime(iso).toLocaleString("en-IN", IST_DATE_TIME_OPTIONS);
}

export function formatIstTime(iso?: string): string {
  if (!iso) return "";
  return parseIstDateTime(iso).toLocaleTimeString("en-IN", IST_TIME_OPTIONS);
}
