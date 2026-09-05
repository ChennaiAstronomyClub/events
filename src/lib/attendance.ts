import { storage } from "@/lib/storage";

export interface AttendanceRecord {
  sheetRow: number;
  name: string;
  email: string;
  phone: string;
  memberType: string;
  adultParticipants: number;
  kidParticipants: number;
  registrantPresent: boolean;
  /**
   * Additional adults present (excludes the named registrant).
   * The sheet column AttendanceAdults stores the total including the registrant.
   */
  adultsPresent: number;
  kidsPresent: number;
  attendanceUpdatedAt: string | null;
}

interface AttendanceListResponse {
  success: boolean;
  formId?: string;
  sheetTab?: string;
  registrations?: AttendanceRecord[];
  version?: number;
  unchanged?: boolean;
  redisUnavailable?: boolean;
  error?: string;
  message?: string;
}

interface AttendanceUpdateResponse {
  success: boolean;
  record?: {
    sheetRow: number;
    email: string;
    registrantPresent: boolean;
    adultsPresent: number;
    kidsPresent: number;
    attendanceUpdatedAt: string;
  };
  version?: number;
  error?: string;
  message?: string;
}

function attendanceHeaders(): HeadersInit {
  const apiKey = storage.getApiKey();
  if (!apiKey) throw new Error("Not logged in");
  return {
    "Content-Type": "application/json",
    "User-Api-Key": apiKey,
  };
}

export async function fetchAttendanceList(formId: string): Promise<AttendanceListResponse> {
  const res = await fetch("/api/attendance", {
    method: "POST",
    headers: attendanceHeaders(),
    body: JSON.stringify({ action: "list", formId }),
  });
  return res.json() as Promise<AttendanceListResponse>;
}

export async function syncAttendanceList(
  formId: string,
  sinceVersion: number
): Promise<AttendanceListResponse> {
  const res = await fetch("/api/attendance", {
    method: "POST",
    headers: attendanceHeaders(),
    body: JSON.stringify({ action: "sync", formId, sinceVersion }),
  });
  return res.json() as Promise<AttendanceListResponse>;
}

export async function updateAttendanceRecord(
  formId: string,
  record: AttendanceRecord,
  patch: {
    registrantPresent: boolean;
    adultsPresent: number;
    kidsPresent: number;
  }
): Promise<AttendanceUpdateResponse> {
  const res = await fetch("/api/attendance", {
    method: "POST",
    headers: attendanceHeaders(),
    body: JSON.stringify({
      action: "update",
      formId,
      sheetRow: record.sheetRow,
      email: record.email,
      registrantPresent: patch.registrantPresent,
      adultsPresent: patch.adultsPresent,
      kidsPresent: patch.kidsPresent,
    }),
  });
  return res.json() as Promise<AttendanceUpdateResponse>;
}

/** Expected headcount for one registration (registrant + additional adults + kids). */
export function expectedHeadcount(record: AttendanceRecord): number {
  return 1 + record.adultParticipants + record.kidParticipants;
}

/** Count of people marked present for one registration. */
export function presentHeadcount(record: AttendanceRecord): number {
  return (
    (record.registrantPresent ? 1 : 0) + record.adultsPresent + record.kidsPresent
  );
}

/** Whether any attendance has been recorded for this registration. */
export function isAnyonePresent(record: AttendanceRecord): boolean {
  return presentHeadcount(record) > 0;
}

/** Best label for a roster row when sheet name is missing. */
export function displayName(record: AttendanceRecord): string {
  const name = record.name.trim();
  if (name) return name;
  const email = record.email.trim();
  if (email) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
  }
  const phone = record.phone.trim();
  if (phone) return phone;
  return "—";
}

export type AttendancePatch = {
  registrantPresent: boolean;
  adultsPresent: number;
  kidsPresent: number;
};

export function clearPatch(): AttendancePatch {
  return { registrantPresent: false, adultsPresent: 0, kidsPresent: 0 };
}

export function fullPartyPatch(record: AttendanceRecord): AttendancePatch {
  return {
    registrantPresent: true,
    adultsPresent: record.adultParticipants,
    kidsPresent: record.kidParticipants,
  };
}

export function partialPatch(
  adultsTotal: number,
  kidsTotal: number,
  record: AttendanceRecord
): AttendancePatch {
  const maxAdults = 1 + record.adultParticipants;
  const clampedAdults = Math.max(0, Math.min(adultsTotal, maxAdults));
  const clampedKids = Math.max(0, Math.min(kidsTotal, record.kidParticipants));
  return {
    registrantPresent: clampedAdults >= 1,
    adultsPresent: Math.max(0, clampedAdults - 1),
    kidsPresent: clampedKids,
  };
}

/** Adults who arrived, including the named registrant. */
export function recordToAdultsTotal(record: AttendanceRecord): number {
  return (record.registrantPresent ? 1 : 0) + record.adultsPresent;
}

export function recordToKidsTotal(record: AttendanceRecord): number {
  return record.kidsPresent;
}

export function maxAdultsTotal(record: AttendanceRecord): number {
  return 1 + record.adultParticipants;
}

/** Human-readable adult/kid counts for who actually arrived. */
export function formatArrivedBreakdown(record: AttendanceRecord): string | null {
  const parts: string[] = [];
  const adultsArrived = (record.registrantPresent ? 1 : 0) + record.adultsPresent;
  const adultsExpected = 1 + record.adultParticipants;

  if (adultsExpected > 0 && adultsArrived > 0) {
    parts.push(`${adultsArrived} adult${adultsArrived !== 1 ? "s" : ""}`);
  }
  if (record.kidParticipants > 0 || record.kidsPresent > 0) {
    parts.push(`${record.kidsPresent} kid${record.kidsPresent !== 1 ? "s" : ""}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Expected guest hint for card header, e.g. "2 adults, 1 kid". */
export function formatExpectedGuestHint(record: AttendanceRecord): string | null {
  const parts: string[] = [];
  const adultsExpected = 1 + record.adultParticipants;
  if (adultsExpected > 1) {
    parts.push(`${adultsExpected} adult${adultsExpected !== 1 ? "s" : ""}`);
  }
  if (record.kidParticipants > 0) {
    parts.push(
      `${record.kidParticipants} kid${record.kidParticipants !== 1 ? "s" : ""}`
    );
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

export function arrivedAdultsCount(records: AttendanceRecord[]): number {
  return records.reduce(
    (sum, r) => sum + (r.registrantPresent ? 1 : 0) + r.adultsPresent,
    0
  );
}

export function arrivedKidsCount(records: AttendanceRecord[]): number {
  return records.reduce((sum, r) => sum + r.kidsPresent, 0);
}

export function expectedAdultsCount(records: AttendanceRecord[]): number {
  return records.reduce((sum, r) => sum + 1 + r.adultParticipants, 0);
}

export function expectedKidsCount(records: AttendanceRecord[]): number {
  return records.reduce((sum, r) => sum + r.kidParticipants, 0);
}
