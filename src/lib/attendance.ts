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
  adultsPresent: number;
  kidsPresent: number;
  attendanceUpdatedAt: string | null;
}

export interface AttendanceListResponse {
  success: boolean;
  formId?: string;
  sheetTab?: string;
  registrations?: AttendanceRecord[];
  error?: string;
  message?: string;
}

export interface AttendanceUpdateResponse {
  success: boolean;
  record?: {
    sheetRow: number;
    email: string;
    registrantPresent: boolean;
    adultsPresent: number;
    kidsPresent: number;
    attendanceUpdatedAt: string;
  };
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
