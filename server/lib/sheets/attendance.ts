import { expectedSheetTabForForm } from "./config.js";
import {
  isMeaningfulRegistrationRow,
  type SheetData,
} from "./logic.js";
import { createRepository } from "./repository.js";
import { getSpreadsheetId } from "./client.js";
import { withSheetTabLock } from "./mutex.js";
import {
  findEmailColumnIndex,
  findHeaderIndex0,
  formatSheetDateTime,
  isPaymentRequired,
  normalizePaymentStatus,
} from "./utils.js";

export const ATTENDANCE_COLUMNS = [
  "AttendanceRegistrant",
  "AttendanceAdults",
  "AttendanceKids",
  "AttendanceUpdatedAt",
] as const;

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

export interface AttendanceListResult {
  success: true;
  formId: string;
  sheetTab: string;
  registrations: AttendanceRecord[];
}

export interface AttendanceUpdateInput {
  formId: string;
  sheetRow: number;
  email: string;
  registrantPresent: boolean;
  adultsPresent: number;
  kidsPresent: number;
}

function parseNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function cellString(headers: string[], row: unknown[], name: string): string {
  const col = findHeaderIndex0(headers, name);
  if (col === -1) return "";
  return String(row[col] ?? "").trim();
}

function isConfirmedRegistrationRow(
  headers: string[],
  rowValues: unknown[],
  formId: string
): boolean {
  const statusCol = findHeaderIndex0(headers, "Status");
  if (statusCol !== -1 && rowValues[statusCol] === "Cancelled") return false;
  if (!isMeaningfulRegistrationRow(headers, rowValues)) return false;

  if (formId) {
    const formIdCol = findHeaderIndex0(headers, "formId");
    if (formIdCol !== -1) {
      const rowFormId = String(rowValues[formIdCol] ?? "").trim();
      if (rowFormId && rowFormId !== formId) return false;
    }
  }

  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  if (paymentStatusCol === -1) return true;

  const requiresPaymentCol = findHeaderIndex0(headers, "RequiresPayment");
  const rowRequiresPayment =
    requiresPaymentCol === -1 || isPaymentRequired(rowValues[requiresPaymentCol]);

  if (!rowRequiresPayment) return true;

  const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol]);
  return paymentStatus === "Paid";
}

function rowToAttendanceRecord(headers: string[], rowValues: unknown[], sheetRow: number): AttendanceRecord {
  const registrantRaw = cellString(headers, rowValues, "AttendanceRegistrant").toLowerCase();
  const updatedAtRaw = cellString(headers, rowValues, "AttendanceUpdatedAt");

  return {
    sheetRow,
    name: cellString(headers, rowValues, "name"),
    email: cellString(headers, rowValues, "email"),
    phone: cellString(headers, rowValues, "phone"),
    memberType: cellString(headers, rowValues, "memberType"),
    adultParticipants: parseNonNegativeInt(cellString(headers, rowValues, "adultParticipants")),
    kidParticipants: parseNonNegativeInt(cellString(headers, rowValues, "kidParticipants")),
    registrantPresent: registrantRaw === "yes",
    adultsPresent: parseNonNegativeInt(cellString(headers, rowValues, "AttendanceAdults")),
    kidsPresent: parseNonNegativeInt(cellString(headers, rowValues, "AttendanceKids")),
    attendanceUpdatedAt: updatedAtRaw || null,
  };
}

function buildRoster(data: SheetData, formId: string): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];

  for (let i = 0; i < data.rows.length; i++) {
    const rowValues = data.rows[i];
    const sheetRow = i + 2;
    if (!isConfirmedRegistrationRow(data.headers, rowValues, formId)) continue;
    records.push(rowToAttendanceRecord(data.headers, rowValues, sheetRow));
  }

  records.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.email.localeCompare(b.email, undefined, { sensitivity: "base" })
  );

  return records;
}

export async function listAttendance(formId: string): Promise<AttendanceListResult | Record<string, unknown>> {
  const trimmedFormId = formId.trim();
  const sheetTab = expectedSheetTabForForm(trimmedFormId);
  if (!sheetTab) {
    return { success: false, error: "Unknown formId" };
  }

  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const data = await repo.readSheetData();
    await repo.ensureColumnMap([...ATTENDANCE_COLUMNS], data);

    return {
      success: true as const,
      formId: trimmedFormId,
      sheetTab,
      registrations: buildRoster(data, trimmedFormId),
    };
  });
}

export async function updateAttendance(
  input: AttendanceUpdateInput
): Promise<Record<string, unknown>> {
  const trimmedFormId = input.formId.trim();
  const sheetTab = expectedSheetTabForForm(trimmedFormId);
  if (!sheetTab) {
    return { success: false, error: "Unknown formId" };
  }

  const sheetRow = Number(input.sheetRow);
  const email = input.email.trim().toLowerCase();
  if (!sheetRow || sheetRow < 2 || !email) {
    return { success: false, error: "Invalid row or email" };
  }

  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const data = await repo.readSheetData();
    const rowIndex = sheetRow - 2;

    if (rowIndex < 0 || rowIndex >= data.rows.length) {
      return { success: false, error: "Registration not found" };
    }

    const rowValues = data.rows[rowIndex];
    if (!isConfirmedRegistrationRow(data.headers, rowValues, trimmedFormId)) {
      return { success: false, error: "Registration not found" };
    }

    const emailCol = findEmailColumnIndex(data.headers);
    const rowEmail =
      emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim().toLowerCase() : "";
    if (rowEmail !== email) {
      return { success: false, error: "Registration not found" };
    }

    const maxAdults = parseNonNegativeInt(cellString(data.headers, rowValues, "adultParticipants"));
    const maxKids = parseNonNegativeInt(cellString(data.headers, rowValues, "kidParticipants"));
    const adultsPresent = Math.min(parseNonNegativeInt(input.adultsPresent), maxAdults);
    const kidsPresent = Math.min(parseNonNegativeInt(input.kidsPresent), maxKids);
    const registrantPresent = Boolean(input.registrantPresent);
    const now = new Date();

    const { map: colMap } = await repo.ensureColumnMap([...ATTENDANCE_COLUMNS], data);
    await repo.updateRowCells(sheetRow, colMap, [
      { key: "AttendanceRegistrant", value: registrantPresent ? "yes" : "no" },
      { key: "AttendanceAdults", value: adultsPresent },
      { key: "AttendanceKids", value: kidsPresent },
      { key: "AttendanceUpdatedAt", value: formatSheetDateTime(now) },
    ]);

    return {
      success: true,
      record: {
        sheetRow,
        email: rowEmail,
        registrantPresent,
        adultsPresent,
        kidsPresent,
        attendanceUpdatedAt: formatSheetDateTime(now),
      },
    };
  });
}
