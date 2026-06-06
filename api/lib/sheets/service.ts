import { PENDING_SEAT_HOLD_MS, REGISTRATION_LIMITS } from "./config.js";
import {
  consolidateDuplicatePendingRows,
  findActiveRowByEmailInData,
  findCancelledRowInData,
  holdStartFromRow,
  listActiveRegistrationEntries,
  rowsOverCapacityLimit,
  scanRegistrations,
  type ScanOptions,
  type SheetData,
} from "./logic.js";
import { createRepository, type SheetRepository } from "./repository.js";
import { getSpreadsheetId } from "./client.js";
import { withSheetTabLock } from "./mutex.js";
import {
  getHoldCache,
  invalidateHoldCache,
  invalidateHoldCacheForTab,
  setHoldCache,
} from "./hold-cache.js";
import {
  getStatusCache,
  invalidateStatusCache,
  setStatusCache,
} from "./status-cache.js";
import {
  findHeaderIndex0,
  isPaymentRequired,
  normalizePaymentStatus,
  sanitizeCell,
} from "./utils.js";

export interface RegistrationUser {
  username: string;
  email: string;
  memberType: string;
}

export type RegistrationAction =
  | "submit"
  | "cancel"
  | "releaseHold"
  | "update"
  | "status"
  | "reserve";

export interface DispatchInput {
  action: RegistrationAction;
  sheetTab: string;
  user: RegistrationUser;
  body: Record<string, unknown>;
}

function scanOpts(body: Record<string, unknown>): ScanOptions | undefined {
  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  return formId ? { formId } : undefined;
}

function isAtCapacity(
  scan: ReturnType<typeof scanRegistrations>,
  limit: number | undefined
): boolean {
  return typeof limit === "number" && scan.activeCount >= limit;
}

async function invalidateRegistrationCaches(sheetTab: string, email?: string): Promise<void> {
  await invalidateStatusCache(sheetTab);
  if (email) await invalidateHoldCache(sheetTab, email);
  else await invalidateHoldCacheForTab(sheetTab);
}

async function cacheHoldFromResponse(
  sheetTab: string,
  email: string,
  result: Record<string, unknown>,
  activeCount: number
): Promise<void> {
  if (!result.success || typeof result.expiresAt !== "string") return;
  const row = typeof result.row === "number" ? result.row : 0;
  if (row <= 0) return;
  await setHoldCache(sheetTab, email, { row, expiresAt: result.expiresAt, activeCount });
}

function registrationFullResponse(): Record<string, unknown> {
  return {
    success: false,
    error: "full",
    message:
      "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
  };
}

/** Read sheet, expire stale holds in one batch, re-read if anything expired. */
async function loadSheetWithExpiry(
  repo: SheetRepository,
  sheetTab: string,
  now: Date,
  opts?: ScanOptions
): Promise<{ data: SheetData; scan: ReturnType<typeof scanRegistrations> }> {
  let data = await repo.readSheetData();
  let scan = scanRegistrations(data.headers, data.rows, now.getTime(), opts);
  if (scan.rowsToExpire.length === 0) return { data, scan };

  await repo.applyExpiredRows(scan.rowsToExpire, data.headers, now);
  await invalidateRegistrationCaches(sheetTab);
  data = await repo.readSheetData();
  scan = scanRegistrations(data.headers, data.rows, now.getTime(), opts);
  return { data, scan };
}

function reserveSuccessPayload(
  row: number,
  expiresAt: string,
  scan: ReturnType<typeof scanRegistrations>,
  limit: number | undefined
): Record<string, unknown> {
  const hasLimit = typeof limit === "number";
  return {
    success: true,
    row,
    expiresAt,
    hasLimit,
    limit: hasLimit ? limit : null,
    activeRegistrations: scan.activeCount,
    isFull: hasLimit ? scan.activeCount >= limit : false,
  };
}

async function resolveExistingReserveRow(
  repo: SheetRepository,
  sheetData: SheetData,
  activeRow: number,
  now: Date,
  scan: ReturnType<typeof scanRegistrations>,
  limit: number | undefined
): Promise<Record<string, unknown>> {
  const headers = sheetData.headers;
  const rowValues = sheetData.rows[activeRow - 2] ?? [];
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const paymentStatus =
    paymentStatusCol !== -1
      ? normalizePaymentStatus(rowValues[paymentStatusCol])
      : "";

  if (paymentStatus === "Paid") {
    return {
      success: false,
      error: "duplicate",
      message: "This email has already been registered for this event.",
    };
  }

  const holdStart = holdStartFromRow(headers, rowValues);
  const holdStillValid =
    Boolean(holdStart) && now.getTime() - holdStart!.getTime() < PENDING_SEAT_HOLD_MS;

  if (paymentStatus === "Pending" && holdStillValid) {
    const expiresAt = new Date(holdStart!.getTime() + PENDING_SEAT_HOLD_MS).toISOString();
    return reserveSuccessPayload(activeRow, expiresAt, scan, limit);
  }

  const { map: cols } = await repo.ensureColumnMap(
    ["RequiresPayment", "PaymentStatus", "PaymentStatusUpdatedAt", "SeatStatus"],
    sheetData
  );
  await repo.updateRowCells(activeRow, cols, [
    { key: "RequiresPayment", value: "true" },
    { key: "PaymentStatus", value: "Pending" },
    { key: "PaymentStatusUpdatedAt", value: now },
    { key: "SeatStatus", value: "Pending" },
  ]);

  const expiresAt = new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString();
  return reserveSuccessPayload(activeRow, expiresAt, scan, limit);
}

/** After append, soft-expire our row if we lost the capacity race. */
async function reconcileReserveAppend(
  repo: SheetRepository,
  sheetTab: string,
  email: string,
  appendedRow: number,
  expiresAt: string,
  limit: number,
  now: Date,
  opts?: ScanOptions
): Promise<Record<string, unknown>> {
  const fresh = await repo.readSheetData();
  const scan = scanRegistrations(fresh.headers, fresh.rows, now.getTime(), opts);
  let ourRow = appendedRow;
  if (ourRow <= 0) {
    ourRow = findActiveRowByEmailInData(fresh.headers, fresh.rows, email);
  }

  const entries = listActiveRegistrationEntries(
    fresh.headers,
    fresh.rows,
    now.getTime(),
    opts
  );
  const losers = rowsOverCapacityLimit(entries, limit);

  if (ourRow > 0 && losers.includes(ourRow)) {
    await repo.applyExpiredRows([ourRow], fresh.headers, now);
    await invalidateRegistrationCaches(sheetTab, email);
    return registrationFullResponse();
  }

  await invalidateRegistrationCaches(sheetTab);
  const result = reserveSuccessPayload(ourRow, expiresAt, scan, limit);
  await cacheHoldFromResponse(sheetTab, email, result, scan.activeCount);
  return result;
}

async function updateSeatStatusForPayment(
  repo: SheetRepository,
  rowIndex: number,
  normalizedPaymentStatus: string,
  sheetName: string,
  headers: string[],
  rows: unknown[][]
) {
  if (!normalizedPaymentStatus) return;
  const seatCol = (await repo.ensureColumnMap(["SeatStatus"], { headers, rows })).map.SeatStatus;

  if (normalizedPaymentStatus === "Pending") {
    await repo.setCell(rowIndex, seatCol, "Pending");
    return;
  }
  if (normalizedPaymentStatus === "Expired") {
    await repo.setCell(rowIndex, seatCol, "Expired");
    return;
  }

  if (normalizedPaymentStatus === "Paid") {
    const limit = REGISTRATION_LIMITS[sheetName];
    const hasLimit = typeof limit === "number";
    const activeNow = scanRegistrations(headers, rows, Date.now()).activeCount;
    const statusCol = findHeaderIndex0(headers, "Status");
    const statusIdx = statusCol !== -1 ? statusCol : -1;
    const rowValues = rows[rowIndex - 2];
    if (statusIdx !== -1 && rowValues?.[statusIdx] === "Cancelled") return;

    const paidAtCol = (await repo.ensureColumnMap(["PaidAt"], { headers, rows })).map.PaidAt;
    const now = new Date();
    await repo.setCell(rowIndex, paidAtCol, now);

    const nextSeatStatus =
      hasLimit && activeNow >= limit ? "Confirmed (Late Payment)" : "Confirmed";
    await repo.setCell(rowIndex, seatCol, nextSeatStatus);
  }
}

async function handleStatus(sheetTab: string): Promise<Record<string, unknown>> {
  const cached = await getStatusCache(sheetTab);
  if (cached) return cached;

  const repo = createRepository(sheetTab);
  const now = new Date();
  let data = await repo.readSheetData();
  let scan = scanRegistrations(data.headers, data.rows, now.getTime());

  if (scan.rowsToExpire.length > 0) {
    await withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
      await repo.applyExpiredRows(scan.rowsToExpire, data.headers, now);
      await invalidateRegistrationCaches(sheetTab);
      data = await repo.readSheetData();
      scan = scanRegistrations(data.headers, data.rows, now.getTime());
    });
  }

  const limit = REGISTRATION_LIMITS[sheetTab];
  const hasLimit = typeof limit === "number";
  const isFull = hasLimit ? scan.activeCount >= limit : false;

  const result = {
    success: true,
    hasLimit,
    limit: hasLimit ? limit : null,
    activeRegistrations: scan.activeCount,
    isFull,
    message: isFull
      ? "Registrations are paused because the event is full. Please contact the organisers if you wish to register."
      : "",
  };
  await setStatusCache(sheetTab, result);
  return result;
}

async function handleReserve(
  sheetTab: string,
  user: RegistrationUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const email = user.email;
  const now = new Date();
  const limit = REGISTRATION_LIMITS[sheetTab];

  // Short-circuit: return cached hold if still valid (avoids all sheet reads).
  const cached = await getHoldCache(sheetTab, email);
  if (cached && cached.expiresAtMs > now.getTime()) {
    return {
      success: true,
      row: cached.row,
      expiresAt: cached.expiresAt,
      hasLimit: typeof limit === "number",
      limit: typeof limit === "number" ? limit : null,
      activeRegistrations: cached.activeCount,
      isFull: typeof limit === "number" ? cached.activeCount >= limit : false,
    };
  }

  return handleReserveWork(sheetTab, user, body);
}

async function handleReserveWork(
  sheetTab: string,
  user: RegistrationUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const email = user.email;
  const repo = createRepository(sheetTab);
  const now = new Date();
  const limit = REGISTRATION_LIMITS[sheetTab];
  const opts = scanOpts(body);

  const preData = await repo.readSheetData();
  const preScan = scanRegistrations(preData.headers, preData.rows, now.getTime(), opts);
  const preActiveRow = findActiveRowByEmailInData(preData.headers, preData.rows, email);

  if (preActiveRow <= 0 && isAtCapacity(preScan, limit)) {
    return registrationFullResponse();
  }

  const reserveFields = [
    { key: "Timestamp", value: now },
    { key: "username", value: user.username || "" },
    { key: "memberType", value: user.memberType || "" },
    { key: "email", value: email },
    { key: "formId", value: String(body.formId ?? "") },
    { key: "RequiresPayment", value: "true" },
    { key: "PaymentStatus", value: "Pending" },
    { key: "PaymentStatusUpdatedAt", value: now },
    { key: "SeatStatus", value: "Pending" },
  ];
  const reserveColumns = reserveFields.map((f) => f.key);

  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    let { data: sheetData, scan } = await loadSheetWithExpiry(repo, sheetTab, now, opts);

    const dup = consolidateDuplicatePendingRows(sheetData.headers, sheetData.rows, email);
    if (dup.expireRows.length > 0) {
      await repo.applyExpiredRows(dup.expireRows, sheetData.headers, now);
      await invalidateRegistrationCaches(sheetTab);
      sheetData = await repo.readSheetData();
      scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime(), opts);
    }

    let activeRow = dup.keepRow;
    if (activeRow <= 0) {
      activeRow = findActiveRowByEmailInData(sheetData.headers, sheetData.rows, email);
    }

    if (activeRow > 0) {
      const result = await resolveExistingReserveRow(
        repo,
        sheetData,
        activeRow,
        now,
        scan,
        limit
      );
      if (result.success) {
        await cacheHoldFromResponse(sheetTab, email, result, scan.activeCount);
      }
      return result;
    }

    if (isAtCapacity(scan, limit)) {
      return registrationFullResponse();
    }

    const { map: cols } = await repo.ensureColumnMap(reserveColumns, sheetData);
    const expiresAt = new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString();
    const appendedRow = await repo.appendRow(cols, reserveFields);

    if (typeof limit !== "number") {
      await invalidateRegistrationCaches(sheetTab);
      const result = reserveSuccessPayload(appendedRow, expiresAt, scan, limit);
      await cacheHoldFromResponse(sheetTab, email, result, scan.activeCount);
      return result;
    }

    return reconcileReserveAppend(
      repo,
      sheetTab,
      email,
      appendedRow,
      expiresAt,
      limit,
      now,
      opts
    );
  });
}

async function handleReleaseHold(
  sheetTab: string,
  user: RegistrationUser
): Promise<Record<string, unknown>> {
  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const email = user.email;
    const now = new Date();
    const data = await repo.readSheetData();
    const activeRow = findActiveRowByEmailInData(data.headers, data.rows, email);
    if (activeRow < 0) return { success: true };

    const paymentStatusCol = findHeaderIndex0(data.headers, "PaymentStatus");
    const rowValues = data.rows[activeRow - 2] ?? [];
    const paymentStatus =
      paymentStatusCol !== -1
        ? normalizePaymentStatus(rowValues[paymentStatusCol])
        : "";

    if (paymentStatus === "Paid") {
      return { success: false, error: "Cannot release paid registration" };
    }

    await repo.applyExpiredRows([activeRow], data.headers, now);
    await invalidateRegistrationCaches(sheetTab, email);
    return { success: true };
  });
}

async function handleCancel(
  sheetTab: string,
  user: RegistrationUser
): Promise<Record<string, unknown>> {
  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const data = await repo.readSheetData();
    const rowIndex = findActiveRowByEmailInData(data.headers, data.rows, user.email);
    if (rowIndex < 0) {
      return { success: false, error: "Registration not found" };
    }
    const statusCol = (await repo.ensureColumnMap(["Status"], data)).map.Status;
    await repo.setCell(rowIndex, statusCol, "Cancelled");
    await invalidateStatusCache(sheetTab);
    return { success: true };
  });
}

async function handleUpdate(
  sheetTab: string,
  user: RegistrationUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const updates = body.updates;
  if (!updates || typeof updates !== "object") {
    return { success: false, error: "Missing updates" };
  }

  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    const data = await repo.readSheetData();
    const rowIndex = findActiveRowByEmailInData(data.headers, data.rows, user.email);
    if (rowIndex < 0) {
      return { success: false, error: "Registration not found" };
    }

    const updateKeys = Object.keys(updates as Record<string, unknown>);
    let nextPaymentStatus = "";
    const colNames = [...updateKeys, "UpdatedAt"];
    if (updateKeys.includes("PaymentStatus")) {
      colNames.push("PaymentStatusUpdatedAt");
    }
    const { map: colMap } = await repo.ensureColumnMap(colNames, data);
    const extras: Array<{ key: string; value: unknown }> = [];
    const now = new Date();

    for (const key of updateKeys) {
      const val = (updates as Record<string, unknown>)[key];
      if (key === "PaymentStatus") {
        nextPaymentStatus = normalizePaymentStatus(val);
        if (nextPaymentStatus) extras.push({ key, value: nextPaymentStatus });
      } else {
        extras.push({ key, value: sanitizeCell(String(val)) });
      }
    }
    extras.push({ key: "UpdatedAt", value: now });
    if (nextPaymentStatus) {
      extras.push({ key: "PaymentStatusUpdatedAt", value: now });
    }
    await repo.updateRowCells(rowIndex, colMap, extras);

    if (nextPaymentStatus) {
      const fresh = await repo.readSheetData();
      await updateSeatStatusForPayment(
        repo,
        rowIndex,
        nextPaymentStatus,
        sheetTab,
        fresh.headers,
        fresh.rows
      );
    }

    return { success: true };
  });
}

async function handleSubmit(
  sheetTab: string,
  user: RegistrationUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const exclude = new Set([
    "secret",
    "sheetTab",
    "action",
    "reserveFields",
    "formData",
    "updates",
  ]);
  const keys = ["Timestamp"];
  const values: unknown[] = [new Date()];

  for (const key of Object.keys(body)) {
    if (!exclude.has(key)) {
      keys.push(sanitizeCell(key) as string);
      values.push(sanitizeCell(body[key]));
    }
  }

  return withSheetTabLock(getSpreadsheetId(), sheetTab, async () => {
    const repo = createRepository(sheetTab);
    await repo.ensurePaymentColumns();
    const email = user.email;
    const requiresPayment = isPaymentRequired(body.requiresPayment);
    const limit = REGISTRATION_LIMITS[sheetTab];
    const now = new Date();

    const { data: sheetData, scan } = await loadSheetWithExpiry(
      repo,
      sheetTab,
      now,
      scanOpts(body)
    );
    const activeRegistrations = scan.activeCount;

    if (requiresPayment && email) {
      const headers = sheetData.headers;
      const emailCol = findHeaderIndex0(headers, "email");
      const statusCol = findHeaderIndex0(headers, "Status");
      const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");

      let paidRow = -1;
      let pendingRow = -1;
      if (emailCol >= 0) {
        for (let i = 0; i < sheetData.rows.length; i++) {
          const rv = sheetData.rows[i];
          const rowEmail = String(rv[emailCol] ?? "").trim().toLowerCase();
          if (rowEmail !== email.toLowerCase()) continue;
          if (statusCol >= 0 && String(rv[statusCol] ?? "").trim().toLowerCase() === "cancelled") continue;
          const ps =
            paymentStatusCol !== -1
              ? normalizePaymentStatus(rv[paymentStatusCol])
              : "";
          if (ps === "Paid" && paidRow < 0) paidRow = i + 2;
          if (ps === "Pending" && pendingRow < 0) pendingRow = i + 2;
        }
      }

      if (paidRow > 0) {
        return {
          success: false,
          error: "duplicate",
          message: "This email has already been registered for this event.",
        };
      }

      if (pendingRow <= 0) {
        return {
          success: false,
          error: "hold_required",
          message:
            "No active seat hold found. Please open the registration form again to reserve a seat before paying.",
        };
      }

      const existingRow = pendingRow;
      const rowValues = sheetData.rows[existingRow - 2] ?? [];
      const holdStart = holdStartFromRow(headers, rowValues);
      const holdStillValid =
        holdStart && now.getTime() - holdStart.getTime() < PENDING_SEAT_HOLD_MS;

      if (holdStillValid) {
        const paidNow = new Date();
        const { map: colMap } = await repo.ensureColumnMap(
          [...keys, "RequiresPayment", "PaymentStatus", "PaymentStatusUpdatedAt", "PaidAt"],
          sheetData
        );
        await repo.writeRowWithExtras(existingRow, colMap, keys, values, [
          { key: "RequiresPayment", value: "true" },
          { key: "PaymentStatus", value: "Paid" },
          { key: "PaymentStatusUpdatedAt", value: paidNow },
          { key: "PaidAt", value: paidNow },
        ]);
        const fresh = await repo.readSheetData();
        await updateSeatStatusForPayment(
          repo,
          existingRow,
          "Paid",
          sheetTab,
          fresh.headers,
          fresh.rows
        );
        await invalidateRegistrationCaches(sheetTab, email);
        return { success: true, row: existingRow };
      }

      return {
        success: false,
        error: "hold_expired",
        message: "Your 5-minute payment window has expired. Please try again.",
      };
    }

    if (email && findActiveRowByEmailInData(sheetData.headers, sheetData.rows, email) > 0) {
      return {
        success: false,
        error: "duplicate",
        message: "This email has already been registered for this event.",
      };
    }

    if (typeof limit === "number" && activeRegistrations >= limit) {
      return {
        success: false,
        error: "full",
        message:
          "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
      };
    }

    if (email) {
      const cancelledRow = findCancelledRowInData(sheetData.headers, sheetData.rows, email);
      if (cancelledRow > 0) {
        const paidNow = new Date();
        const { map: colMap } = await repo.ensureColumnMap(
          [
            ...keys,
            "Status",
            "RequiresPayment",
            "PaymentStatus",
            "PaymentStatusUpdatedAt",
            "SeatStatus",
            "PaidAt",
          ],
          sheetData
        );
        await repo.writeRowWithExtras(cancelledRow, colMap, keys, values, [
          { key: "Status", value: "" },
          { key: "RequiresPayment", value: requiresPayment ? "true" : "false" },
          { key: "PaymentStatus", value: "Paid" },
          { key: "PaymentStatusUpdatedAt", value: paidNow },
          { key: "SeatStatus", value: "Confirmed" },
          { key: "PaidAt", value: paidNow },
        ]);
        await invalidateRegistrationCaches(sheetTab, email);
        return { success: true, row: cancelledRow };
      }
    }

    if (requiresPayment) {
      return {
        success: false,
        error: "hold_required",
        message:
          "No active seat hold found. Please open the registration form again to reserve a seat before paying.",
      };
    }

    const paidNow = new Date();
    const { map: colMap } = await repo.ensureColumnMap(
      [
        ...keys,
        "RequiresPayment",
        "PaymentStatus",
        "PaymentStatusUpdatedAt",
        "SeatStatus",
        "PaidAt",
      ],
      sheetData
    );
    const appendFields: Array<{ key: string; value: unknown }> = [];
    for (let i = 0; i < keys.length; i++) {
      appendFields.push({ key: keys[i], value: values[i] });
    }
    appendFields.push(
      { key: "RequiresPayment", value: requiresPayment ? "true" : "false" },
      { key: "PaymentStatus", value: "Paid" },
      { key: "PaymentStatusUpdatedAt", value: paidNow },
      { key: "SeatStatus", value: "Confirmed" },
      { key: "PaidAt", value: paidNow }
    );
    const appendedRow = await repo.appendRow(colMap, appendFields);
    await invalidateRegistrationCaches(sheetTab, email);
    return { success: true, row: appendedRow };
  });
}

export async function dispatchRegistration(
  input: DispatchInput
): Promise<Record<string, unknown>> {
  const { action, sheetTab, user, body } = input;

  if (!/^[\w\s-]+$/.test(sheetTab)) {
    return { success: false, error: "Invalid sheet name" };
  }

  switch (action) {
    case "status":
      return handleStatus(sheetTab);
    case "reserve":
      return handleReserve(sheetTab, user, body);
    case "releaseHold":
      return handleReleaseHold(sheetTab, user);
    case "cancel":
      return handleCancel(sheetTab, user);
    case "update":
      return handleUpdate(sheetTab, user, body);
    case "submit":
      return handleSubmit(sheetTab, user, body);
    default:
      return { success: false, error: "Invalid action" };
  }
}
