import { PENDING_SEAT_HOLD_MS } from "./config.js";
import {
  findColumnIndex1,
  findEmailColumnIndex,
  findHeaderIndex0,
  isPaymentRequired,
  normalizePaymentStatus,
  parseSheetDate,
} from "./utils.js";

export interface SheetData {
  headers: string[];
  rows: unknown[][];
}

export function isMeaningfulRegistrationRow(headers: string[], rowValues: unknown[]): boolean {
  const emailIndex = findEmailColumnIndex(headers);
  if (emailIndex !== -1) {
    return String(rowValues[emailIndex] ?? "").trim() !== "";
  }
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i] ?? "").trim();
    if (header === "Timestamp" || header === "Status") continue;
    if (String(rowValues[i] ?? "").trim() !== "") return true;
  }
  return false;
}

export interface ScanOptions {
  /** When set, skip rows whose formId column is non-empty and different. */
  formId?: string;
}

export function scanRegistrations(
  headers: string[],
  rows: unknown[][],
  nowMs: number,
  options?: ScanOptions
) {
  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findHeaderIndex0(headers, "PaymentStatusUpdatedAt");
  const requiresPaymentCol = findHeaderIndex0(headers, "RequiresPayment");
  const timestampCol = findHeaderIndex0(headers, "Timestamp");
  const formIdCol =
    options?.formId?.trim() ? findHeaderIndex0(headers, "formId") : -1;
  const filterFormId = options?.formId?.trim() ?? "";

  let activeCount = 0;
  const rowsToExpire: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowValues = rows[i];
    const sheetRow = i + 2;

    if (statusCol !== -1 && rowValues[statusCol] === "Cancelled") continue;
    if (!isMeaningfulRegistrationRow(headers, rowValues)) continue;

    if (formIdCol !== -1 && filterFormId) {
      const rowFormId = String(rowValues[formIdCol] ?? "").trim();
      if (rowFormId && rowFormId !== filterFormId) continue;
    }

    if (paymentStatusCol === -1) {
      activeCount += 1;
      continue;
    }

    const rowRequiresPayment =
      requiresPaymentCol === -1 || isPaymentRequired(rowValues[requiresPaymentCol]);

    if (!rowRequiresPayment) {
      activeCount += 1;
      continue;
    }

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol]);
    if (paymentStatus === "Paid") {
      activeCount += 1;
      continue;
    }
    if (paymentStatus === "Expired") continue;

    // Empty or Pending — treat as a hold for capacity unless we can prove it expired.
    if (paymentStatus !== "Pending" && paymentStatus !== "") continue;

    const paymentUpdatedAt =
      paymentUpdatedAtCol !== -1
        ? parseSheetDate(rowValues[paymentUpdatedAtCol])
        : null;
    const createdAt =
      timestampCol !== -1 ? parseSheetDate(rowValues[timestampCol]) : null;
    const holdStart = paymentUpdatedAt || createdAt;

    if (!holdStart) {
      activeCount += 1;
      continue;
    }

    if (nowMs - holdStart.getTime() >= PENDING_SEAT_HOLD_MS) {
      rowsToExpire.push(sheetRow);
      continue;
    }

    activeCount += 1;
  }

  return { activeCount, rowsToExpire };
}

/** One counted seat (paid or valid pending hold). */
export interface ActiveRegistrationEntry {
  sheetRow: number;
  email: string;
  /** Lower = earlier registration; used to pick who keeps a seat when over capacity. */
  sortKey: number;
}

/** Same rules as scanRegistrations — used to resolve concurrent overbooking by row. */
export function listActiveRegistrationEntries(
  headers: string[],
  rows: unknown[][],
  nowMs: number,
  options?: ScanOptions
): ActiveRegistrationEntry[] {
  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const requiresPaymentCol = findHeaderIndex0(headers, "RequiresPayment");
  const emailCol = findEmailColumnIndex(headers);
  const formIdCol =
    options?.formId?.trim() ? findHeaderIndex0(headers, "formId") : -1;
  const filterFormId = options?.formId?.trim() ?? "";

  const entries: ActiveRegistrationEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowValues = rows[i];
    const sheetRow = i + 2;

    if (statusCol !== -1 && rowValues[statusCol] === "Cancelled") continue;
    if (!isMeaningfulRegistrationRow(headers, rowValues)) continue;

    if (formIdCol !== -1 && filterFormId) {
      const rowFormId = String(rowValues[formIdCol] ?? "").trim();
      if (rowFormId && rowFormId !== filterFormId) continue;
    }

    if (paymentStatusCol === -1) {
      entries.push({
        sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }

    const rowRequiresPayment =
      requiresPaymentCol === -1 || isPaymentRequired(rowValues[requiresPaymentCol]);

    if (!rowRequiresPayment) {
      entries.push({
        sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol]);
    if (paymentStatus === "Paid") {
      const holdStart = holdStartFromRow(headers, rowValues);
      entries.push({
        sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim() : "",
        sortKey: holdStart?.getTime() ?? sheetRow,
      });
      continue;
    }
    if (paymentStatus === "Expired") continue;
    if (paymentStatus !== "Pending" && paymentStatus !== "") continue;

    const holdStart = holdStartFromRow(headers, rowValues);
    if (!holdStart) {
      entries.push({
        sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }
    if (nowMs - holdStart.getTime() >= PENDING_SEAT_HOLD_MS) continue;

    entries.push({
      sheetRow,
      email: emailCol !== -1 ? String(rowValues[emailCol] ?? "").trim() : "",
      sortKey: holdStart.getTime(),
    });
  }

  return entries;
}

/** Rows that exceed the cap (latest holds / highest row numbers lose). */
export function rowsOverCapacityLimit(
  entries: ActiveRegistrationEntry[],
  limit: number
): number[] {
  if (entries.length <= limit) return [];
  const sorted = [...entries].sort(
    (a, b) => a.sortKey - b.sortKey || a.sheetRow - b.sheetRow
  );
  return sorted.slice(limit).map((e) => e.sheetRow);
}

export function findActiveRowByEmailInData(
  headers: string[],
  rows: unknown[][],
  email: string
): number {
  const emailCol = findEmailColumnIndex(headers);
  const statusCol1 = findColumnIndex1(headers, "Status");
  const statusCol = statusCol1 > 0 ? statusCol1 - 1 : -1;
  if (emailCol === -1) return -1;

  const target = email.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (statusCol !== -1 && rows[i][statusCol] === "Cancelled") continue;
    if (String(rows[i][emailCol] ?? "").toLowerCase() === target) return i + 2;
  }
  return -1;
}

export function findCancelledRowInData(
  headers: string[],
  rows: unknown[][],
  email: string
): number {
  const emailCol = findEmailColumnIndex(headers);
  const statusCol = findHeaderIndex0(headers, "Status");
  if (emailCol === -1 || statusCol === -1) return -1;

  const target = email.toLowerCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][statusCol] !== "Cancelled") continue;
    if (String(rows[i][emailCol] ?? "").toLowerCase() === target) return i + 2;
  }
  return -1;
}

export function holdStartFromRow(headers: string[], rowValues: unknown[]): Date | null {
  const paymentUpdatedAtCol = findHeaderIndex0(headers, "PaymentStatusUpdatedAt");
  const timestampCol = findHeaderIndex0(headers, "Timestamp");
  const paymentUpdatedAt =
    paymentUpdatedAtCol !== -1
      ? parseSheetDate(rowValues[paymentUpdatedAtCol])
      : null;
  const createdAt =
    timestampCol !== -1 ? parseSheetDate(rowValues[timestampCol]) : null;
  return paymentUpdatedAt || createdAt;
}

export function consolidateDuplicatePendingRows(
  headers: string[],
  rows: unknown[][],
  email: string
): { keepRow: number; expireRows: number[] } {
  const emailCol = findEmailColumnIndex(headers);
  if (emailCol === -1) return { keepRow: -1, expireRows: [] };

  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const target = email.toLowerCase();
  const pendingRows: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (statusCol !== -1 && rows[i][statusCol] === "Cancelled") continue;
    if (String(rows[i][emailCol] ?? "").toLowerCase() !== target) continue;

    const paymentStatus =
      paymentStatusCol !== -1
        ? normalizePaymentStatus(rows[i][paymentStatusCol])
        : "";
    if (paymentStatus === "Paid") return { keepRow: i + 2, expireRows: [] };
    if (paymentStatus === "Pending" || paymentStatus === "") {
      pendingRows.push(i + 2);
    }
  }

  if (pendingRows.length === 0) return { keepRow: -1, expireRows: [] };
  if (pendingRows.length === 1) return { keepRow: pendingRows[0], expireRows: [] };

  pendingRows.sort((a, b) => b - a);
  return {
    keepRow: pendingRows[0],
    expireRows: pendingRows.slice(1),
  };
}
