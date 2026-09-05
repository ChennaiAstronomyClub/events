import { expectedSheetTabForForm } from "./config.js";
import {
  isMeaningfulRegistrationRow,
  type SheetData,
} from "./logic.js";
import { createRepository } from "./repository.js";
import { getSpreadsheetId } from "./client.js";
import { withSheetTabLock } from "./mutex.js";
import {
  cellToApiValue,
  columnIndexToLetter,
  escapeSheetTab,
  findEmailColumnIndex,
  findHeaderIndex0,
  formatSheetDateTime,
  isPaymentRequired,
  normalizePaymentStatus,
} from "./utils.js";
import {
  hydrateAttendanceCache,
  isRedisConfigured,
  patchAttendanceCount,
  readAttendanceCache,
} from "./attendance-cache.js";

const ATTENDANCE_COLUMNS = [
  "AttendanceRegistrant",
  "AttendanceAdults",
  "AttendanceKids",
  "AttendanceUpdatedAt",
] as const;

interface AttendanceRecord {
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

interface AttendanceListResult {
  success: true;
  formId: string;
  sheetTab: string;
  registrations: AttendanceRecord[];
  version: number;
}

interface AttendanceSyncUnchanged {
  success: true;
  unchanged: true;
  version: number;
  formId: string;
  sheetTab: string;
}

interface AttendanceSyncUnavailable {
  success: true;
  redisUnavailable: true;
}

interface AttendanceUpdateInput {
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

/** Sheets API omits trailing empty cells; pad so column indices stay aligned. */
function padRow(row: unknown[], headerCount: number): unknown[] {
  if (row.length >= headerCount) return row;
  return [...row, ...Array(headerCount - row.length).fill("")];
}

function cellRaw(headers: string[], row: unknown[], name: string): unknown {
  const col = findHeaderIndex0(headers, name);
  if (col === -1) return "";
  return row[col] ?? "";
}

function cellString(headers: string[], row: unknown[], name: string): string {
  return String(cellRaw(headers, row, name) ?? "").trim();
}

/**
 * Legacy rows store AttendanceRegistrant as "yes"/"no" and AttendanceAdults as
 * additional adults only. New rows use boolean true/false and a total that
 * includes the named registrant.
 */
type RegistrantEncoding = "legacy" | "total";

interface ParsedRegistrant {
  encoding: RegistrantEncoding;
  present: boolean;
  recorded: boolean;
}

function parseRegistrantCell(raw: unknown): ParsedRegistrant {
  if (raw === true) return { encoding: "total", present: true, recorded: true };
  if (raw === false) return { encoding: "total", present: false, recorded: true };

  const text = String(raw ?? "").trim();
  if (!text) return { encoding: "legacy", present: false, recorded: false };

  const lower = text.toLowerCase();
  if (lower === "true") return { encoding: "total", present: true, recorded: true };
  if (lower === "false") return { encoding: "total", present: false, recorded: true };
  if (lower === "yes") return { encoding: "legacy", present: true, recorded: true };
  if (lower === "no") return { encoding: "legacy", present: false, recorded: true };

  return { encoding: "legacy", present: false, recorded: true };
}

/** API/client adultsPresent is additional-only; the sheet column is a total. */
function additionalAdultsFromSheet(
  storedAdults: number,
  registrant: ParsedRegistrant
): number {
  if (registrant.encoding === "total" && registrant.present) {
    return Math.max(0, storedAdults - 1);
  }
  return storedAdults;
}

function sheetAdultsFromAdditional(
  additional: number,
  registrantPresent: boolean
): number {
  return (registrantPresent ? 1 : 0) + additional;
}

const NAME_COLUMN_CANDIDATES = ["name", "Full Name", "fullName"];

function resolveRegistrantName(headers: string[], row: unknown[]): string {
  for (const column of NAME_COLUMN_CANDIDATES) {
    const value = cellString(headers, row, column);
    if (value) return value;
  }
  return cellString(headers, row, "username");
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
  const registrant = parseRegistrantCell(cellRaw(headers, rowValues, "AttendanceRegistrant"));
  const storedAdults = parseNonNegativeInt(cellRaw(headers, rowValues, "AttendanceAdults"));
  const updatedAtRaw = cellString(headers, rowValues, "AttendanceUpdatedAt");

  return {
    sheetRow,
    name: resolveRegistrantName(headers, rowValues),
    email: cellString(headers, rowValues, "email"),
    phone: cellString(headers, rowValues, "phone"),
    memberType: cellString(headers, rowValues, "memberType"),
    adultParticipants: parseNonNegativeInt(cellString(headers, rowValues, "adultParticipants")),
    kidParticipants: parseNonNegativeInt(cellString(headers, rowValues, "kidParticipants")),
    registrantPresent: registrant.present,
    adultsPresent: additionalAdultsFromSheet(storedAdults, registrant),
    kidsPresent: parseNonNegativeInt(cellString(headers, rowValues, "AttendanceKids")),
    attendanceUpdatedAt: updatedAtRaw || null,
  };
}

function rowHasRecordedAttendance(
  headers: string[],
  rowValues: unknown[]
): boolean {
  const registrant = parseRegistrantCell(cellRaw(headers, rowValues, "AttendanceRegistrant"));
  if (registrant.recorded) return true;
  if (parseNonNegativeInt(cellRaw(headers, rowValues, "AttendanceAdults")) > 0) return true;
  if (parseNonNegativeInt(cellRaw(headers, rowValues, "AttendanceKids")) > 0) return true;
  return Boolean(cellString(headers, rowValues, "AttendanceUpdatedAt"));
}

function collectLegacyAttendanceRewrites(
  data: SheetData,
  formId: string,
  colMap: Record<string, number>,
  sheetTab: string
): Array<{ range: string; values: unknown[][] }> {
  const tab = escapeSheetTab(sheetTab);
  const registrantCol = colMap.AttendanceRegistrant;
  const adultsCol = colMap.AttendanceAdults;
  if (!registrantCol || !adultsCol) return [];

  const ranges: Array<{ range: string; values: unknown[][] }> = [];
  const headerCount = data.headers.length;

  for (let i = 0; i < data.rows.length; i++) {
    const rowValues = padRow(data.rows[i], headerCount);
    if (!isConfirmedRegistrationRow(data.headers, rowValues, formId)) continue;

    const registrant = parseRegistrantCell(cellRaw(data.headers, rowValues, "AttendanceRegistrant"));
    if (registrant.encoding !== "legacy") continue;
    if (!rowHasRecordedAttendance(data.headers, rowValues)) continue;

    const storedAdults = parseNonNegativeInt(cellRaw(data.headers, rowValues, "AttendanceAdults"));
    const additional = additionalAdultsFromSheet(storedAdults, registrant);
    const sheetRow = i + 2;
    ranges.push({
      range: `${tab}!${columnIndexToLetter(registrantCol)}${sheetRow}`,
      values: [[cellToApiValue(registrant.present)]],
    });
    ranges.push({
      range: `${tab}!${columnIndexToLetter(adultsCol)}${sheetRow}`,
      values: [[cellToApiValue(sheetAdultsFromAdditional(additional, registrant.present))]],
    });
  }

  return ranges;
}

function buildRoster(data: SheetData, formId: string): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  const headerCount = data.headers.length;

  for (let i = 0; i < data.rows.length; i++) {
    const rowValues = padRow(data.rows[i], headerCount);
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

  const listed = await withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const initial = await repo.readSheetData();
    const { map: colMap, data } = await repo.ensureColumnMap(
      [...ATTENDANCE_COLUMNS],
      initial
    );

    const rewrites = collectLegacyAttendanceRewrites(
      data,
      trimmedFormId,
      colMap,
      sheetTab
    );
    if (rewrites.length > 0) {
      await repo.batchValuesUpdate(rewrites);
    }

    return {
      success: true as const,
      formId: trimmedFormId,
      sheetTab,
      registrations: buildRoster(data, trimmedFormId),
    };
  });

  const hydrated = await hydrateAttendanceCache(trimmedFormId, listed.registrations);
  return {
    ...listed,
    registrations: hydrated.registrations,
    version: hydrated.version,
  };
}

export async function syncAttendance(
  formId: string,
  sinceVersion: number
): Promise<
  | AttendanceListResult
  | AttendanceSyncUnchanged
  | AttendanceSyncUnavailable
  | Record<string, unknown>
> {
  const trimmedFormId = formId.trim();
  const sheetTab = expectedSheetTabForForm(trimmedFormId);
  if (!sheetTab) {
    return { success: false, error: "Unknown formId" };
  }

  if (!isRedisConfigured()) {
    return { success: true, redisUnavailable: true };
  }

  const cached = await readAttendanceCache(trimmedFormId);
  if (!cached) {
    return listAttendance(trimmedFormId);
  }

  if (sinceVersion === cached.version) {
    return {
      success: true,
      unchanged: true,
      version: cached.version,
      formId: trimmedFormId,
      sheetTab,
    };
  }

  return {
    success: true,
    formId: trimmedFormId,
    sheetTab,
    registrations: cached.registrations,
    version: cached.version,
  };
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

    const rowValues = padRow(data.rows[rowIndex], data.headers.length);
    if (!isConfirmedRegistrationRow(data.headers, rowValues, trimmedFormId)) {
      return { success: false, error: "Registration not found" };
    }

    const emailCol = findEmailColumnIndex(data.headers);
    const rowEmail =
      emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim().toLowerCase() : "";
    if (rowEmail !== email) {
      return { success: false, error: "Registration not found" };
    }

    const maxAdditional = parseNonNegativeInt(
      cellString(data.headers, rowValues, "adultParticipants")
    );
    const maxKids = parseNonNegativeInt(cellString(data.headers, rowValues, "kidParticipants"));
    const adultsPresent = Math.min(parseNonNegativeInt(input.adultsPresent), maxAdditional);
    const kidsPresent = Math.min(parseNonNegativeInt(input.kidsPresent), maxKids);
    const registrantPresent = Boolean(input.registrantPresent);
    const now = new Date();

    const { map: colMap } = await repo.ensureColumnMap([...ATTENDANCE_COLUMNS], data);
    const updatedAt = formatSheetDateTime(now);
    await repo.updateRowCells(sheetRow, colMap, [
      { key: "AttendanceRegistrant", value: registrantPresent },
      { key: "AttendanceAdults", value: sheetAdultsFromAdditional(adultsPresent, registrantPresent) },
      { key: "AttendanceKids", value: kidsPresent },
      { key: "AttendanceUpdatedAt", value: updatedAt },
    ]);

    const version = await patchAttendanceCount(trimmedFormId, {
      sheetRow,
      registrantPresent,
      adultsPresent,
      kidsPresent,
      attendanceUpdatedAt: updatedAt,
    });

    return {
      success: true,
      record: {
        sheetRow,
        email: rowEmail,
        registrantPresent,
        adultsPresent,
        kidsPresent,
        attendanceUpdatedAt: updatedAt,
      },
      version,
    };
  });
}
