import {
  isRedisConfigured,
  redisExpire,
  redisGet,
  redisHGetAll,
  redisHSet,
  redisIncr,
  redisSet,
} from "../redis/client.js";

/** Live check-in cache TTL; refreshed on each write. */
const ATTENDANCE_CACHE_TTL_S = 6 * 60 * 60;

export interface AttendanceCounts {
  registrantPresent: boolean;
  adultsPresent: number;
  kidsPresent: number;
  attendanceUpdatedAt: string | null;
}

export interface AttendanceRosterRecord extends AttendanceCounts {
  sheetRow: number;
  name: string;
  email: string;
  phone: string;
  memberType: string;
  adultParticipants: number;
  kidParticipants: number;
}

function rosterKey(formId: string): string {
  return `attendance:${formId}:roster`;
}

function countsKey(formId: string): string {
  return `attendance:${formId}:counts`;
}

function versionKey(formId: string): string {
  return `attendance:${formId}:version`;
}

/** Sheet timestamps are `d/m/yyyy h:mm:ss` (unpadded day/month/hour). */
function parseSheetDateTimeMs(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const [, day, month, year, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime();
}

function countsFromRecord(record: AttendanceRosterRecord): AttendanceCounts {
  return {
    registrantPresent: record.registrantPresent,
    adultsPresent: record.adultsPresent,
    kidsPresent: record.kidsPresent,
    attendanceUpdatedAt: record.attendanceUpdatedAt,
  };
}

function parseCounts(raw: unknown): AttendanceCounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    registrantPresent: Boolean(row.registrantPresent),
    adultsPresent: Number(row.adultsPresent) || 0,
    kidsPresent: Number(row.kidsPresent) || 0,
    attendanceUpdatedAt:
      typeof row.attendanceUpdatedAt === "string" && row.attendanceUpdatedAt.trim()
        ? row.attendanceUpdatedAt
        : null,
  };
}

function isCountsNewerOrEqual(
  live: AttendanceCounts,
  roster: AttendanceRosterRecord
): boolean {
  return (
    parseSheetDateTimeMs(live.attendanceUpdatedAt) >=
    parseSheetDateTimeMs(roster.attendanceUpdatedAt)
  );
}

function overlayRecord(
  record: AttendanceRosterRecord,
  live: AttendanceCounts | null
): AttendanceRosterRecord {
  if (!live || !isCountsNewerOrEqual(live, record)) return record;
  return {
    ...record,
    registrantPresent: live.registrantPresent,
    adultsPresent: live.adultsPresent,
    kidsPresent: live.kidsPresent,
    attendanceUpdatedAt: live.attendanceUpdatedAt,
  };
}

export function mergeRosterWithCounts(
  roster: AttendanceRosterRecord[],
  counts: Record<string, unknown> | null
): AttendanceRosterRecord[] {
  if (!counts) return roster;
  return roster.map((record) =>
    overlayRecord(record, parseCounts(counts[String(record.sheetRow)]))
  );
}

async function getAttendanceCounts(
  formId: string
): Promise<Record<string, unknown> | null> {
  return redisHGetAll<Record<string, unknown>>(countsKey(formId));
}

async function getAttendanceRoster(
  formId: string
): Promise<AttendanceRosterRecord[] | null> {
  const roster = await redisGet<AttendanceRosterRecord[]>(rosterKey(formId));
  if (!Array.isArray(roster)) return null;
  return roster;
}

async function getAttendanceVersion(formId: string): Promise<number | null> {
  const value = await redisGet<number | string>(versionKey(formId));
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function refreshAttendanceTtls(formId: string): Promise<void> {
  await Promise.all([
    redisExpire(countsKey(formId), ATTENDANCE_CACHE_TTL_S),
    redisExpire(versionKey(formId), ATTENDANCE_CACHE_TTL_S),
  ]);
}

/**
 * Replace the roster snapshot from a Sheets read, overlay any newer live
 * counts, seed missing hash fields, and bump the version.
 */
export async function hydrateAttendanceCache(
  formId: string,
  roster: AttendanceRosterRecord[]
): Promise<{ registrations: AttendanceRosterRecord[]; version: number }> {
  if (!isRedisConfigured()) {
    return { registrations: roster, version: 0 };
  }

  const existingCounts = await getAttendanceCounts(formId);
  const merged = mergeRosterWithCounts(roster, existingCounts);
  await redisSet(rosterKey(formId), merged, ATTENDANCE_CACHE_TTL_S);

  const fields: Record<string, AttendanceCounts> = {};
  for (const sheetRecord of roster) {
    const live = parseCounts(existingCounts?.[String(sheetRecord.sheetRow)]);
    if (
      live &&
      parseSheetDateTimeMs(live.attendanceUpdatedAt) >
        parseSheetDateTimeMs(sheetRecord.attendanceUpdatedAt)
    ) {
      continue;
    }
    fields[String(sheetRecord.sheetRow)] = countsFromRecord(sheetRecord);
  }
  await redisHSet(countsKey(formId), fields);

  const version = (await redisIncr(versionKey(formId))) ?? 0;
  await refreshAttendanceTtls(formId);
  return { registrations: merged, version };
}

/** Patch one row's live counts after a successful Sheets write. */
export async function patchAttendanceCount(
  formId: string,
  counts: AttendanceCounts & { sheetRow: number }
): Promise<number> {
  if (!isRedisConfigured()) return 0;

  const { sheetRow, ...live } = counts;
  await redisHSet(countsKey(formId), { [String(sheetRow)]: live });
  const version = (await redisIncr(versionKey(formId))) ?? 0;
  await refreshAttendanceTtls(formId);
  return version;
}

export async function readAttendanceCache(
  formId: string
): Promise<{
  version: number;
  registrations: AttendanceRosterRecord[];
} | null> {
  if (!isRedisConfigured()) return null;

  const [version, roster] = await Promise.all([
    getAttendanceVersion(formId),
    getAttendanceRoster(formId),
  ]);
  if (version == null || roster == null) return null;

  const counts = await getAttendanceCounts(formId);
  return { version, registrations: mergeRosterWithCounts(roster, counts) };
}

export { isRedisConfigured };
