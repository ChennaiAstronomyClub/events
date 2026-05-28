/**
 * Google Apps Script — Spreadsheet-bound script for receiving form submissions
 * and appending to Google Sheets.
 *
 * This script handles TWO submission sources:
 *   1. React app  — via doPost() web-app endpoint
 *   2. Google Form — via onFormSubmit() spreadsheet trigger
 *
 * Supported actions (passed as data.action in POST body):
 *   "submit" (default) — append a new row (or reactivate a cancelled one)
 *   "cancel"           — mark an existing row as Cancelled (soft-delete)
 *   "releaseHold"      — delete a Pending payment hold row (expired timer)
 *   "update"           — patch specific columns of an existing row
 *
 * Deployment (as a bound script):
 *   1. Open your Google Sheet → Extensions → Apps Script
 *   2. Replace Code.gs contents with this file
 *   3. Update SHARED_SECRET below
 *   4. Deploy → New Deployment → Web app (Execute as: Me, Access: Anyone)
 *   5. Copy the deployment URL into .env as VITE_APPS_SCRIPT_URL
 *
 * Google Form trigger:
 *   1. Link your Google Form to this spreadsheet (Form → Responses → Sheets icon)
 *   2. Triggers (clock icon) → Add Trigger
 *      Function: onFormSubmit  |  Event source: From spreadsheet  |  On form submit
 *   3. Authorize when prompted
 *
 * Requires V8 runtime (default since 2020): Apps Script → Project settings → V8
 */

// ---- CONFIGURATION ----
const SHARED_SECRET = "9f201af7a3ac8dc296481909bacc9242";

// Maximum payload size (bytes). Rejects oversized requests early.
const MAX_PAYLOAD_BYTES = 50000; // ~50 KB
// Per-sheet cap for active registrations (excluding cancelled rows).
const REGISTRATION_LIMITS = {
  "May 31 Entries": 6,
};
const PENDING_SEAT_HOLD_MS = 5 * 60 * 1000; // 5 minutes
// Max time to wait for the script lock (ms)
const LOCK_WAIT_MS = 8000;
const STATUS_CACHE_TTL_SEC = 10;
const BUSY_MESSAGE =
  "Registration is busy right now. Please wait a moment and try again.";
// ---- END CONFIGURATION ----

// ---- HELPERS ----

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function busyResponse() {
  return jsonResponse({
    success: false,
    error: "busy",
    message: BUSY_MESSAGE,
  });
}

function statusCacheKey(sheetName) {
  return "status_" + sheetName;
}

function invalidateStatusCache(sheetName) {
  try {
    CacheService.getScriptCache().remove(statusCacheKey(sheetName));
  } catch (e) {
    // cache miss or quota — safe to ignore
  }
}

/** 1-based column index → A1 column letter(s). */
function columnIndexToLetter(col) {
  let letter = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Acquire the script lock or return null when contended.
 */
function acquireScriptLock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return null;
  }
  return lock;
}

/**
 * Sanitize a cell value to prevent spreadsheet formula injection.
 * If a string starts with =, +, -, or @ it could be interpreted as a
 * formula when the sheet is opened in Excel or exported as CSV.
 * Applied to BOTH values AND column-header keys written to the sheet.
 */
function sanitizeCell(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Return the 1-based column index of `name` in `headers`, or -1 if absent.
 */
function findColumnIndex(headers, name) {
  const target = String(name).trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === target) return i + 1;
  }
  return -1;
}

/** 0-based email column index in a header row, or -1. */
function findEmailColumnIndex(headers) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === "email") return i;
  }
  return -1;
}

function normalizePaymentStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pending") return "Pending";
  if (normalized === "paid") return "Paid";
  if (normalized === "expired") return "Expired";
  return "";
}

function parseSheetDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const dmyTime = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (dmyTime) {
      const day = Number(dmyTime[1]);
      const month = Number(dmyTime[2]) - 1;
      const year = Number(dmyTime[3]);
      const hour = dmyTime[4] !== undefined ? Number(dmyTime[4]) : 0;
      const minute = dmyTime[5] !== undefined ? Number(dmyTime[5]) : 0;
      const second = dmyTime[6] !== undefined ? Number(dmyTime[6]) : 0;
      const parsedDmy = new Date(year, month, day, hour, minute, second);
      if (!Number.isNaN(parsedDmy.getTime())) return parsedDmy;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/** 0-based column index in a header row, or -1 (case-insensitive). */
function findHeaderIndex0(headers, name) {
  const col1 = findColumnIndex(headers, name);
  return col1 > 0 ? col1 - 1 : -1;
}

function isPaymentRequired(value) {
  return value === true || String(value).trim().toLowerCase() === "true";
}

function ensurePaymentColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers =
    lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const needed = [
    "RequiresPayment",
    "PaymentStatus",
    "PaymentStatusUpdatedAt",
    "SeatStatus",
    "PaidAt",
  ];
  let nextCol = headers.length;

  for (let i = 0; i < needed.length; i++) {
    if (headers.indexOf(needed[i]) !== -1) continue;
    nextCol += 1;
    sheet.getRange(1, nextCol).setValue(sanitizeCell(needed[i]));
    headers.push(needed[i]);
  }
}

/**
 * Read header row + all data rows in one round trip.
 */
function readSheetData(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { headers: [], rows: [] };
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return { headers, rows };
}

/**
 * Count active registrations and find stale pending holds in a single pass.
 */
function scanRegistrations(headers, rows, nowMs) {
  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findHeaderIndex0(headers, "PaymentStatusUpdatedAt");
  const requiresPaymentCol = findHeaderIndex0(headers, "RequiresPayment");
  const timestampCol = findHeaderIndex0(headers, "Timestamp");
  let activeCount = 0;
  const rowsToExpire = [];

  for (let i = 0; i < rows.length; i++) {
    const rowValues = rows[i];
    const sheetRow = i + 2;

    if (statusCol !== -1 && rowValues[statusCol] === "Cancelled") continue;
    if (!isMeaningfulRegistrationRow(headers, rowValues)) continue;

    if (paymentStatusCol === -1) {
      activeCount += 1;
      continue;
    }

    if (
      requiresPaymentCol !== -1 &&
      !isPaymentRequired(rowValues[requiresPaymentCol])
    ) {
      activeCount += 1;
      continue;
    }

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol]);
    if (paymentStatus === "Paid") {
      activeCount += 1;
      continue;
    }
    if (paymentStatus !== "Pending") continue;

    const paymentUpdatedAt =
      paymentUpdatedAtCol !== -1
        ? parseSheetDate(rowValues[paymentUpdatedAtCol])
        : null;
    const createdAt =
      timestampCol !== -1 ? parseSheetDate(rowValues[timestampCol]) : null;
    const holdStart = paymentUpdatedAt || createdAt;
    if (!holdStart) continue;

    if (nowMs - holdStart.getTime() >= PENDING_SEAT_HOLD_MS) {
      rowsToExpire.push(sheetRow);
      continue;
    }

    activeCount += 1;
  }

  return { activeCount, rowsToExpire };
}

/** Active seats for capacity tie-break (earlier hold / lower row wins). */
function listActiveRegistrationEntries(headers, rows, nowMs) {
  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findHeaderIndex0(headers, "PaymentStatusUpdatedAt");
  const requiresPaymentCol = findHeaderIndex0(headers, "RequiresPayment");
  const timestampCol = findHeaderIndex0(headers, "Timestamp");
  const emailCol = findEmailColumnIndex(headers);
  const entries = [];

  for (let i = 0; i < rows.length; i++) {
    const rowValues = rows[i];
    const sheetRow = i + 2;

    if (statusCol !== -1 && rowValues[statusCol] === "Cancelled") continue;
    if (!isMeaningfulRegistrationRow(headers, rowValues)) continue;

    if (paymentStatusCol === -1) {
      entries.push({
        sheetRow: sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] || "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }

    if (
      requiresPaymentCol !== -1 &&
      !isPaymentRequired(rowValues[requiresPaymentCol])
    ) {
      entries.push({
        sheetRow: sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] || "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol]);
    if (paymentStatus === "Paid") {
      const holdStart = holdStartFromRow(headers, rowValues);
      entries.push({
        sheetRow: sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] || "").trim() : "",
        sortKey: holdStart ? holdStart.getTime() : sheetRow,
      });
      continue;
    }
    if (paymentStatus === "Expired") continue;
    if (paymentStatus !== "Pending" && paymentStatus !== "") continue;

    const holdStart = holdStartFromRow(headers, rowValues);
    if (!holdStart) {
      entries.push({
        sheetRow: sheetRow,
        email: emailCol !== -1 ? String(rowValues[emailCol] || "").trim() : "",
        sortKey: sheetRow,
      });
      continue;
    }
    if (nowMs - holdStart.getTime() >= PENDING_SEAT_HOLD_MS) continue;

    entries.push({
      sheetRow: sheetRow,
      email: emailCol !== -1 ? String(rowValues[emailCol] || "").trim() : "",
      sortKey: holdStart.getTime(),
    });
  }

  return entries;
}

function rowsOverCapacityLimit(entries, limit) {
  if (entries.length <= limit) return [];
  const sorted = entries.slice().sort(function (a, b) {
    return a.sortKey - b.sortKey || a.sheetRow - b.sheetRow;
  });
  return sorted.slice(limit).map(function (e) {
    return e.sheetRow;
  });
}

function applyExpiredRows(sheet, rowsToExpire, headers, now) {
  if (rowsToExpire.length === 0) return 0;

  const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findColumnIndex(headers, "PaymentStatusUpdatedAt");
  const seatStatusCol = ensureColumn(sheet, "SeatStatus");

  const psLetter = columnIndexToLetter(paymentStatusCol);
  const ssLetter = columnIndexToLetter(seatStatusCol);
  sheet
    .getRangeList(rowsToExpire.map(function (r) { return psLetter + r; }))
    .setValue("Expired");
  sheet
    .getRangeList(rowsToExpire.map(function (r) { return ssLetter + r; }))
    .setValue("Expired");
  if (paymentUpdatedAtCol > 0) {
    const puLetter = columnIndexToLetter(paymentUpdatedAtCol);
    sheet
      .getRangeList(rowsToExpire.map(function (r) { return puLetter + r; }))
      .setValue(now);
  }

  return rowsToExpire.length;
}

/**
 * Expire stale holds and return the current active registration count (one sheet read).
 */
function syncRegistrationCapacity(sheet) {
  const data = readSheetData(sheet);
  const now = new Date();
  const scan = scanRegistrations(data.headers, data.rows, now.getTime());
  applyExpiredRows(sheet, scan.rowsToExpire, data.headers, now);
  return scan.activeCount;
}

function findActiveRowByEmailInData(headers, rows, email) {
  const emailCol = findEmailColumnIndex(headers);
  const statusCol1 = findColumnIndex(headers, "Status");
  const statusCol = statusCol1 > 0 ? statusCol1 - 1 : -1;
  if (emailCol === -1) return -1;

  const target = String(email).toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (statusCol !== -1 && rows[i][statusCol] === "Cancelled") continue;
    if (String(rows[i][emailCol]).toLowerCase() === target) return i + 2;
  }
  return -1;
}

/**
 * If parallel reserve calls created duplicate Pending holds, keep the newest row
 * and delete the rest. Returns the 1-based row index to use, or -1.
 */
function consolidateDuplicatePendingHolds(sheet, headers, rows, email) {
  const emailCol = findEmailColumnIndex(headers);
  if (emailCol === -1) return -1;

  const statusCol = findHeaderIndex0(headers, "Status");
  const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
  const target = String(email).toLowerCase();
  const pendingRows = [];

  for (let i = 0; i < rows.length; i++) {
    if (statusCol !== -1 && rows[i][statusCol] === "Cancelled") continue;
    if (String(rows[i][emailCol]).toLowerCase() !== target) continue;

    const paymentStatus =
      paymentStatusCol !== -1
        ? normalizePaymentStatus(rows[i][paymentStatusCol])
        : "";
    if (paymentStatus === "Paid") return i + 2;
    if (paymentStatus === "Pending" || paymentStatus === "") {
      pendingRows.push(i + 2);
    }
  }

  if (pendingRows.length === 0) return -1;
  if (pendingRows.length === 1) return pendingRows[0];

  pendingRows.sort(function (a, b) {
    return b - a;
  });
  const keepRow = pendingRows[0];
  for (let j = 1; j < pendingRows.length; j++) {
    sheet.deleteRow(pendingRows[j]);
  }
  return keepRow;
}

function holdStartFromRow(headers, rowValues) {
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

/**
 * Decide whether a row should be treated as a real registration.
 * Prefer a non-empty email column when available; otherwise require at least
 * one non-empty non-metadata cell.
 */
function isMeaningfulRegistrationRow(headers, rowValues) {
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

/**
 * Find the 1-based row index of the first active (non-cancelled) registration
 * for the given email. Returns -1 if not found.
 */
function findActiveRowByEmail(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const emailCol = findColumnIndex(headers, "email");
  const statusCol = findColumnIndex(headers, "Status");

  if (emailCol < 0) return -1;

  const numRows = lastRow - 1;
  const target = String(email).toLowerCase();

  if (statusCol > 0) {
    const minCol = Math.min(emailCol, statusCol);
    const width = Math.max(emailCol, statusCol) - minCol + 1;
    const block = sheet.getRange(2, minCol, numRows, width).getValues();
    const eOff = emailCol - minCol;
    const sOff = statusCol - minCol;
    for (let j = 0; j < block.length; j++) {
      if (block[j][sOff] === "Cancelled") continue;
      if (String(block[j][eOff]).toLowerCase() === target) return j + 2;
    }
    return -1;
  }

  const emailValues = sheet.getRange(2, emailCol, numRows, 1).getValues();
  for (let j = 0; j < emailValues.length; j++) {
    if (String(emailValues[j][0]).toLowerCase() === target) return j + 2;
  }
  return -1;
}

/**
 * Return the 1-based column index for colName. If the column doesn't exist,
 * write colName (sanitized) to the next empty header cell and return its new index.
 */
function ensureColumn(sheet, colName) {
  const safeName = sanitizeCell(String(colName));
  const lastCol = sheet.getLastColumn();

  if (lastCol === 0) {
    sheet.getRange(1, 1).setValue(safeName);
    return 1;
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existing = headers.indexOf(colName);
  if (existing !== -1) return existing + 1;

  // Not found — append to header row
  const newIndex = lastCol + 1;
  sheet.getRange(1, newIndex).setValue(safeName);
  return newIndex;
}

function writeKeyedRow(sheet, rowIndex, keys, values, colMap) {
  const map = colMap || ensureColumnMap(sheet, keys);
  const maxCol = Math.max.apply(null, Object.values(map));
  const rowData = new Array(maxCol).fill("");
  for (let i = 0; i < keys.length; i++) {
    rowData[map[keys[i]] - 1] = values[i];
  }
  sheet.getRange(rowIndex, 1, 1, maxCol).setValues([rowData]);
}

/** Write keys/values plus optional extra {key,value} fields in one setValues call. */
function writeRowWithExtras(sheet, rowIndex, colMap, keys, values, extras) {
  const maxCol = Math.max.apply(null, Object.values(colMap));
  const rowData = new Array(maxCol).fill("");
  for (let i = 0; i < keys.length; i++) {
    rowData[colMap[keys[i]] - 1] = values[i];
  }
  for (let i = 0; extras && i < extras.length; i++) {
    const col = colMap[extras[i].key];
    if (col) rowData[col - 1] = extras[i].value;
  }
  sheet.getRange(rowIndex, 1, 1, maxCol).setValues([rowData]);
}

/**
 * One header read; returns 1-based column indices (creates missing header cells).
 */
function ensureColumnMap(sheet, colNames) {
  const unique = [];
  for (let i = 0; i < colNames.length; i++) {
    if (unique.indexOf(colNames[i]) === -1) unique.push(colNames[i]);
  }

  const lastCol = sheet.getLastColumn();
  const headers =
    lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  let nextCol = headers.length;
  const map = {};

  for (let i = 0; i < unique.length; i++) {
    const name = unique[i];
    let idx = headers.indexOf(name);
    if (idx === -1) {
      nextCol += 1;
      sheet.getRange(1, nextCol).setValue(sanitizeCell(String(name)));
      headers.push(name);
      idx = headers.length - 1;
    }
    map[name] = idx + 1;
  }

  return map;
}

function setPaymentPendingForRow(sheet, rowIndex, now) {
  const cols = ensureColumnMap(sheet, [
    "RequiresPayment",
    "PaymentStatus",
    "PaymentStatusUpdatedAt",
    "SeatStatus",
  ]);
  const maxCol = Math.max(
    cols.RequiresPayment,
    cols.PaymentStatus,
    cols.PaymentStatusUpdatedAt,
    cols.SeatStatus
  );
  const rowData = new Array(maxCol).fill("");
  rowData[cols.RequiresPayment - 1] = "true";
  rowData[cols.PaymentStatus - 1] = "Pending";
  rowData[cols.PaymentStatusUpdatedAt - 1] = now;
  rowData[cols.SeatStatus - 1] = "Pending";
  sheet.getRange(rowIndex, 1, 1, maxCol).setValues([rowData]);
}

/** Minimal hold row — form fields are written on submit, not on reserve. */
function appendReserveHoldRow(sheet, payload, now, knownLastRow) {
  const keys = [
    "Timestamp",
    "username",
    "memberType",
    "email",
    "formId",
    "RequiresPayment",
    "PaymentStatus",
    "PaymentStatusUpdatedAt",
    "SeatStatus",
  ];
  const values = [
    now,
    payload.username || "",
    payload.memberType || "",
    payload.email,
    payload.formId || "",
    "true",
    "Pending",
    now,
    "Pending",
  ];
  const cols = ensureColumnMap(sheet, keys);
  const rowIndex = Math.max(knownLastRow != null ? knownLastRow : sheet.getLastRow(), 1) + 1;
  const maxCol = Math.max.apply(null, Object.values(cols));
  const rowData = new Array(maxCol).fill("");
  for (let i = 0; i < keys.length; i++) {
    rowData[cols[keys[i]] - 1] = values[i];
  }
  sheet.getRange(rowIndex, 1, 1, maxCol).setValues([rowData]);
  return rowIndex;
}

/**
 * Find the 1-based row index of the most recent CANCELLED registration for
 * the given email. Returns -1 if none exists.
 */
function findCancelledRowByEmail(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const emailCol = findColumnIndex(headers, "email");
  const statusCol = findColumnIndex(headers, "Status");

  // No Status column means no rows have ever been cancelled
  if (emailCol < 0 || statusCol < 0) return -1;

  const numRows = lastRow - 1;
  const emailValues = sheet.getRange(2, emailCol, numRows, 1).getValues();
  const statusValues = sheet.getRange(2, statusCol, numRows, 1).getValues();

  for (let j = 0; j < emailValues.length; j++) {
    if (
      String(statusValues[j][0]) === "Cancelled" &&
      String(emailValues[j][0]).toLowerCase() === String(email).toLowerCase()
    ) {
      return j + 2; // 1-based row index
    }
  }
  return -1;
}

function findHoldStartForRow(sheet, rowIndex, headers, rowValues) {
  if (!headers) {
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return null;
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }
  if (!rowValues) {
    rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  }
  return holdStartFromRow(headers, rowValues);
}

/** Count active registrations (read-only; does not expire stale holds). */
function countActiveRegistrations(sheet) {
  const data = readSheetData(sheet);
  return scanRegistrations(data.headers, data.rows, Date.now()).activeCount;
}

function updateSeatStatusForPayment(sheet, rowIndex, normalizedPaymentStatus, sheetName) {
  if (!normalizedPaymentStatus) return;
  const seatStatusCol = ensureColumn(sheet, "SeatStatus");
  const now = new Date();

  if (normalizedPaymentStatus === "Pending") {
    sheet.getRange(rowIndex, seatStatusCol).setValue("Pending");
    return;
  }

  if (normalizedPaymentStatus === "Expired") {
    sheet.getRange(rowIndex, seatStatusCol).setValue("Expired");
    return;
  }

  if (normalizedPaymentStatus === "Paid") {
    const limit = REGISTRATION_LIMITS[sheetName];
    const hasLimit = typeof limit === "number";
    const activeNow = countActiveRegistrations(sheet);
    const statusCol = ensureColumn(sheet, "Status");
    const isCancelled = sheet.getRange(rowIndex, statusCol).getValue() === "Cancelled";

    // If row is cancelled, keep seat status unchanged.
    if (isCancelled) return;

    // Keep late payments distinguishable when capacity is already fully consumed.
    const paidAtCol = ensureColumn(sheet, "PaidAt");
    sheet.getRange(rowIndex, paidAtCol).setValue(now);

    const nextSeatStatus =
      hasLimit && activeNow >= limit ? "Confirmed (Late Payment)" : "Confirmed";
    sheet.getRange(rowIndex, seatStatusCol).setValue(nextSeatStatus);
  }
}

function expireStalePendingRows(sheet) {
  const data = readSheetData(sheet);
  const now = new Date();
  const scan = scanRegistrations(data.headers, data.rows, now.getTime());
  return applyExpiredRows(sheet, scan.rowsToExpire, data.headers, now);
}

/**
 * Return current capacity state for a sheet (lock-free read; cached 10s).
 */
function handleStatus(sheetName, sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = statusCacheKey(sheetName);
  const hit = cache.get(cacheKey);
  if (hit) return jsonResponse(JSON.parse(hit));

  const data = readSheetData(sheet);
  const now = new Date();
  let scan = scanRegistrations(data.headers, data.rows, now.getTime());

  if (scan.rowsToExpire.length > 0) {
    const lock = acquireScriptLock();
    if (lock) {
      try {
        applyExpiredRows(sheet, scan.rowsToExpire, data.headers, now);
        invalidateStatusCache(sheetName);
        const refreshed = readSheetData(sheet);
        scan = scanRegistrations(refreshed.headers, refreshed.rows, now.getTime());
      } finally {
        lock.releaseLock();
      }
    }
  }

  const limit = REGISTRATION_LIMITS[sheetName];
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
  cache.put(cacheKey, JSON.stringify(result), STATUS_CACHE_TTL_SEC);
  return jsonResponse(result);
}

/**
 * If this email already has a row, resolve hold/duplicate before capacity checks.
 * Prevents "full" when the only taken slot is this user's own pending hold (e.g. limit 1 + retry).
 */
function reserveResponseForExistingRow(sheet, sheetData, activeRow, now) {
  const lastCol = sheet.getLastColumn();
  const headers =
    lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : sheetData.headers;
  const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
  const paymentStatus =
    paymentStatusCol > 0
      ? normalizePaymentStatus(sheet.getRange(activeRow, paymentStatusCol).getValue())
      : "";

  if (paymentStatus === "Paid") {
    return jsonResponse({
      success: false,
      error: "duplicate",
      message: "This email has already been registered for this event.",
    });
  }

  const rowValues =
    sheetData.rows[activeRow - 2] ||
    sheet.getRange(activeRow, 1, 1, lastCol).getValues()[0];
  const holdStart = holdStartFromRow(headers, rowValues);
  const holdStillValid =
    holdStart && now.getTime() - holdStart.getTime() < PENDING_SEAT_HOLD_MS;
  const expiresAt = holdStillValid
    ? new Date(holdStart.getTime() + PENDING_SEAT_HOLD_MS).toISOString()
    : new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString();

  if (paymentStatus === "Pending" && holdStillValid) {
    return jsonResponse({ success: true, row: activeRow, expiresAt: expiresAt });
  }

  setPaymentPendingForRow(sheet, activeRow, now);
  return jsonResponse({
    success: true,
    row: activeRow,
    expiresAt: new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString(),
  });
}

function handleReserve(data, sheetName, sheet) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });
  // Always run hold logic for reserve — never handleStatus (status has no expiresAt).

  const preData = readSheetData(sheet);
  const now = new Date();
  const preScan = scanRegistrations(preData.headers, preData.rows, now.getTime());
  const limit = REGISTRATION_LIMITS[sheetName];
  const preActiveRow = findActiveRowByEmailInData(preData.headers, preData.rows, email);
  if (preActiveRow <= 0 && typeof limit === "number" && preScan.activeCount >= limit) {
    return jsonResponse({
      success: false,
      error: "full",
      message:
        "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
    });
  }

  const lock = acquireScriptLock();
  if (!lock) return busyResponse();

  try {
    ensurePaymentColumns(sheet);
    let sheetData = readSheetData(sheet);
    let scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime());
    if (applyExpiredRows(sheet, scan.rowsToExpire, sheetData.headers, now) > 0) {
      sheetData = readSheetData(sheet);
      scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime());
      invalidateStatusCache(sheetName);
    }

    let activeRow = consolidateDuplicatePendingHolds(
      sheet,
      sheetData.headers,
      sheetData.rows,
      email
    );
    if (activeRow > 0) {
      sheetData = readSheetData(sheet);
      scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime());
      return reserveResponseForExistingRow(sheet, sheetData, activeRow, now);
    }

    activeRow = findActiveRowByEmailInData(sheetData.headers, sheetData.rows, email);
    if (activeRow > 0) {
      return reserveResponseForExistingRow(sheet, sheetData, activeRow, now);
    }

    activeRow = findActiveRowByEmail(sheet, email);
    if (activeRow > 0) {
      sheetData = readSheetData(sheet);
      return reserveResponseForExistingRow(sheet, sheetData, activeRow, now);
    }

    if (typeof limit === "number" && scan.activeCount >= limit) {
      return jsonResponse({
        success: false,
        error: "full",
        message:
          "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
      });
    }

    const knownLastRow = sheetData.rows.length > 0 ? sheetData.rows.length + 1 : 1;
    const appendedRow = appendReserveHoldRow(
      sheet,
      {
        username: data.username || "",
        memberType: data.memberType || "",
        email,
        formId: data.formId || "",
      },
      now,
      knownLastRow
    );
    sheetData = readSheetData(sheet);
    if (typeof limit === "number") {
      const entries = listActiveRegistrationEntries(
        sheetData.headers,
        sheetData.rows,
        now.getTime()
      );
      const losers = rowsOverCapacityLimit(entries, limit);
      if (losers.indexOf(appendedRow) !== -1) {
        sheet.deleteRow(appendedRow);
        invalidateStatusCache(sheetName);
        return jsonResponse({
          success: false,
          error: "full",
          message:
            "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
        });
      }
    }
    invalidateStatusCache(sheetName);

    return jsonResponse({
      success: true,
      row: appendedRow,
      expiresAt: new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString(),
    });
  } finally {
    lock.releaseLock();
  }
}

// ---- ACTION HANDLERS ----

/**
 * Delete an unpaid Pending hold row (used when the client-side timer expires).
 */
function handleReleaseHold(data, sheet, sheetName) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });

  const lock = acquireScriptLock();
  if (!lock) return busyResponse();

  try {
    const rowIndex = findActiveRowByEmail(sheet, email);
    if (rowIndex < 0) {
      return jsonResponse({ success: true });
    }

    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
    const paymentStatus =
      paymentStatusCol > 0
        ? normalizePaymentStatus(sheet.getRange(rowIndex, paymentStatusCol).getValue())
        : "";

    if (paymentStatus === "Paid") {
      return jsonResponse({
        success: false,
        error: "Cannot release paid registration",
      });
    }

    sheet.deleteRow(rowIndex);
    invalidateStatusCache(sheetName);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Soft-delete a registration by setting its Status column to "Cancelled".
 * Identified by email address.
 */
function handleCancel(data, sheet, sheetName) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });

  const lock = acquireScriptLock();
  if (!lock) return busyResponse();

  try {
    const rowIndex = findActiveRowByEmail(sheet, email);
    if (rowIndex < 0) {
      return jsonResponse({ success: false, error: "Registration not found" });
    }

    const statusCol = ensureColumn(sheet, "Status");
    sheet.getRange(rowIndex, statusCol).setValue("Cancelled");
    invalidateStatusCache(sheetName);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Patch specific columns of an existing active registration.
 * data.updates is an object of { columnKey: newValue } pairs.
 * Also sets/updates an "UpdatedAt" timestamp column.
 */
function handleUpdate(data, sheet) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });

  const updates = data.updates;
  if (!updates || typeof updates !== "object") {
    return jsonResponse({ success: false, error: "Missing updates" });
  }

  const lock = acquireScriptLock();
  if (!lock) return busyResponse();

  try {
    const rowIndex = findActiveRowByEmail(sheet, email);
    if (rowIndex < 0) {
      return jsonResponse({ success: false, error: "Registration not found" });
    }

    const updateKeys = Object.keys(updates);
    let nextPaymentStatus = "";
    const colNames = updateKeys.concat(["UpdatedAt"]);
    if (updateKeys.indexOf("PaymentStatus") !== -1) {
      colNames.push("PaymentStatusUpdatedAt");
    }
    const colMap = ensureColumnMap(sheet, colNames);
    const extras = [];
    const now = new Date();
    for (let i = 0; i < updateKeys.length; i++) {
      const key = updateKeys[i];
      if (key === "PaymentStatus") {
        nextPaymentStatus = normalizePaymentStatus(updates[key]);
        if (nextPaymentStatus) extras.push({ key: key, value: nextPaymentStatus });
      } else {
        extras.push({ key: key, value: sanitizeCell(String(updates[key])) });
      }
    }
    extras.push({ key: "UpdatedAt", value: now });
    if (nextPaymentStatus) {
      extras.push({ key: "PaymentStatusUpdatedAt", value: now });
    }
    writeRowWithExtras(sheet, rowIndex, colMap, [], [], extras);

    if (nextPaymentStatus) {
      updateSeatStatusForPayment(
        sheet,
        rowIndex,
        nextPaymentStatus,
        data.sheetTab || "Sheet1"
      );
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- WEB APP ENDPOINTS ----

function doPost(e) {
  try {
    // Guard against oversized payloads
    const raw = e.postData.contents;
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ success: false, error: "Payload too large" });
    }

    const data = JSON.parse(raw);

    // Authenticate
    if (data.secret !== SHARED_SECRET) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = data.sheetTab || "Sheet1";

    // Whitelist sheet-tab names: alphanumeric, spaces, hyphens only
    if (!/^[\w\s-]+$/.test(sheetName)) {
      return jsonResponse({ success: false, error: "Invalid sheet name" });
    }

    const sheet = ss.getSheetByName(sheetName) ?? ss.insertSheet(sheetName);

    // Dispatch on action
    const action = data.action || "submit";
    if (action === "status") return handleStatus(sheetName, sheet);
    if (action === "reserve") return handleReserve(data, sheetName, sheet);
    if (action === "cancel") return handleCancel(data, sheet, sheetName);
    if (action === "releaseHold") return handleReleaseHold(data, sheet, sheetName);
    if (action === "update") return handleUpdate(data, sheet);

    // ---- SUBMIT action (default) ----

    // Build row data — exclude internal fields.
    // Keys are sanitized here to prevent formula injection in the header row.
    const exclude = new Set(["secret", "sheetTab", "action"]);
    const keys = ["Timestamp"];
    const values = [new Date()];

    for (const key of Object.keys(data)) {
      if (!exclude.has(key)) {
        keys.push(sanitizeCell(String(key)));
        values.push(sanitizeCell(data[key]));
      }
    }

    const lock = acquireScriptLock();
    if (!lock) return busyResponse();

    try {
      ensurePaymentColumns(sheet);
      const email = data.email;
      const requiresPayment = isPaymentRequired(data.requiresPayment);
      const limit = REGISTRATION_LIMITS[sheetName];
      const now = new Date();
      let sheetData = readSheetData(sheet);
      let scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime());
      if (applyExpiredRows(sheet, scan.rowsToExpire, sheetData.headers, now) > 0) {
        sheetData = readSheetData(sheet);
        scan = scanRegistrations(sheetData.headers, sheetData.rows, now.getTime());
        invalidateStatusCache(sheetName);
      }
      let activeRegistrations = scan.activeCount;

      if (requiresPayment && email) {
        const existingRow = findActiveRowByEmailInData(
          sheetData.headers,
          sheetData.rows,
          email
        );
        if (existingRow <= 0) {
          return jsonResponse({
            success: false,
            error: "hold_required",
            message:
              "No active seat hold found. Please open the registration form again to reserve a seat before paying.",
          });
        }

        const headers = sheetData.headers;
        const rowValues = sheetData.rows[existingRow - 2];
        const paymentStatusCol = findHeaderIndex0(headers, "PaymentStatus");
        const paymentStatus =
          paymentStatusCol !== -1
            ? normalizePaymentStatus(rowValues[paymentStatusCol])
            : "";
        const holdStart = holdStartFromRow(headers, rowValues);
        const holdStillValid =
          holdStart && now.getTime() - holdStart.getTime() < PENDING_SEAT_HOLD_MS;

        if (paymentStatus === "Pending" && holdStillValid) {
          const paidNow = new Date();
          const colMap = ensureColumnMap(sheet, keys.concat([
            "RequiresPayment",
            "PaymentStatus",
            "PaymentStatusUpdatedAt",
            "PaidAt",
          ]));
          writeRowWithExtras(sheet, existingRow, colMap, keys, values, [
            { key: "RequiresPayment", value: "true" },
            { key: "PaymentStatus", value: "Paid" },
            { key: "PaymentStatusUpdatedAt", value: paidNow },
            { key: "PaidAt", value: paidNow },
          ]);
          updateSeatStatusForPayment(sheet, existingRow, "Paid", sheetName);
          invalidateStatusCache(sheetName);
          return jsonResponse({ success: true, row: existingRow });
        }

        if (paymentStatus === "Pending" && !holdStillValid) {
          return jsonResponse({
            success: false,
            error: "hold_expired",
            message: "Your 5-minute payment window has expired. Please try again.",
          });
        }

        return jsonResponse({
          success: false,
          error: "duplicate",
          message: "This email has already been registered for this event.",
        });
      }

      // ---- DUPLICATE CHECK (by email, skipping cancelled rows) ----
      if (email && findActiveRowByEmailInData(sheetData.headers, sheetData.rows, email) > 0) {
        return jsonResponse({
          success: false,
          error: "duplicate",
          message: "This email has already been registered for this event.",
        });
      }
      // ---- END DUPLICATE CHECK ----

      // ---- CAPACITY CHECK (uses count from initial read; lock held, no re-scan) ----
      if (typeof limit === "number" && activeRegistrations >= limit) {
        return jsonResponse({
          success: false,
          error: "full",
          message: "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
        });
      }
      // ---- END CAPACITY CHECK ----

      // If a cancelled row exists for this email, reactivate it in place
      // instead of appending a new row.
      if (email) {
        const cancelledRow = findCancelledRowByEmail(sheet, email);
        if (cancelledRow > 0) {
          const paidNow = new Date();
          const colMap = ensureColumnMap(sheet, keys.concat([
            "Status",
            "RequiresPayment",
            "PaymentStatus",
            "PaymentStatusUpdatedAt",
            "SeatStatus",
            "PaidAt",
          ]));
          writeRowWithExtras(sheet, cancelledRow, colMap, keys, values, [
            { key: "Status", value: "" },
            { key: "RequiresPayment", value: requiresPayment ? "true" : "false" },
            { key: "PaymentStatus", value: "Paid" },
            { key: "PaymentStatusUpdatedAt", value: paidNow },
            { key: "SeatStatus", value: "Confirmed" },
            { key: "PaidAt", value: paidNow },
          ]);
          invalidateStatusCache(sheetName);
          return jsonResponse({ success: true, row: cancelledRow });
        }
      }

      if (requiresPayment) {
        return jsonResponse({
          success: false,
          error: "hold_required",
          message:
            "No active seat hold found. Please open the registration form again to reserve a seat before paying.",
        });
      }

      const knownLastRow = sheetData.rows.length > 0 ? sheetData.rows.length + 1 : 1;
      const appendedRow = knownLastRow + 1;
      const paidNow = new Date();
      const colMap = ensureColumnMap(sheet, keys.concat([
        "RequiresPayment",
        "PaymentStatus",
        "PaymentStatusUpdatedAt",
        "SeatStatus",
        "PaidAt",
      ]));
      writeRowWithExtras(sheet, appendedRow, colMap, keys, values, [
        { key: "RequiresPayment", value: requiresPayment ? "true" : "false" },
        { key: "PaymentStatus", value: "Paid" },
        { key: "PaymentStatusUpdatedAt", value: paidNow },
        { key: "SeatStatus", value: "Confirmed" },
        { key: "PaidAt", value: paidNow },
      ]);
      invalidateStatusCache(sheetName);

      return jsonResponse({ success: true, row: appendedRow });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  }
}

function doGet() {
  return jsonResponse({ status: "ok", message: "Sheets proxy is running" });
}

// ---- GOOGLE FORM CONSOLIDATION ----

/**
 * Multiple event configurations for Google Form consolidation.
 *
 * Each entry maps a Google Form's response sheet tab to a target (React-app)
 * sheet tab, along with the field map for that event's questions.
 *
 * To add a new event:
 *   1. Link a new Google Form to this spreadsheet (it creates e.g. "Form Responses 2")
 *   2. Add an entry here with formResponseTab matching the auto-created tab name
 *   3. Set targetSheetTab to the React-app's sheetTab for this event
 *   4. Define the fieldMap mapping Google Form question titles → column keys
 *
 * The onFormSubmit trigger uses e.range to detect which form submitted,
 * then routes data to the correct target sheet.
 */
const FORM_EVENT_CONFIGS = [
  {
    formResponseTab: "Form Responses 1",
    targetSheetTab: "Entries",
    fieldMap: {
      "Full Name": "name",
      "Email ID": "email",
      "Contact number": "phone",
      "Age Group": "age",
      "Which nights will you be joining?": "nights",
      "Equipment that you will bring": "equipment",
      "Can you bring a car and offer carpooling to other participants?": "canBringCar",
      "Number of seats available to other participants": "carSeats",
      "Where will you be coming from?": "location",
      "Describe your observational skills and experience": "observationalSkills",
      "Why do you want to attend this event?": "eventReason",
      "Emergency contact person and number": "emergencyContact",
      "Blood group": "bloodGroup",
      "Smoking, consuming alcohol and other anti-social behavior are strictly prohibited":
        "conductCode",
      "Disclaimer - Travelling by road involves inherent dangers including but not limited to accidents. CAC and its organizers are not responsible for any accidents or injuries during the event. CAC and organizers are not responsible for any loss or damage to personal property. The participant agrees to take full responsibility on the above":
        "riskDisclaimer",
      "Anything else that you would like to ask the CAC team?": "additionalQuestions",
    },
  },
  // Add more events here, e.g.:
  // {
  //   formResponseTab: "Form Responses 2",
  //   targetSheetTab: "April Entries",
  //   fieldMap: { ... },
  // },
];

/**
 * Look up the event config for a Google Form submission by matching the
 * sheet tab where the form wrote its response row.
 * Falls back to the first config if no match (single-form setup).
 */
function getFormEventConfig(sourceSheetName) {
  const match = FORM_EVENT_CONFIGS.find(
    (c) => c.formResponseTab === sourceSheetName
  );
  return match || FORM_EVENT_CONFIGS[0];
}

/**
 * Installable trigger for Google Form submissions (spreadsheet-bound).
 *
 * The spreadsheet trigger provides e.namedValues (question title → [answers])
 * rather than the Form trigger's e.response.getItemResponses().
 *
 * Supports multiple events: uses e.range to identify which Google Form
 * submitted, then routes data to the correct target sheet tab.
 */
function onFormSubmit(e) {
  // Determine which event this form submission belongs to
  const sourceSheet = e.range ? e.range.getSheet().getName() : "";
  const eventConfig = getFormEventConfig(sourceSheet);
  const fieldMap = eventConfig.fieldMap;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet =
    ss.getSheetByName(eventConfig.targetSheetTab) ??
    ss.insertSheet(eventConfig.targetSheetTab);

  const namedValues = e.namedValues ?? {};
  const data = {};

  for (const [title, answers] of Object.entries(namedValues)) {
    const key = fieldMap[title];
    if (key) {
      data[key] = answers
        .filter((a) => a !== "")
        .map((a) => sanitizeCell(a))
        .join(", ");
    }
  }

  // Read existing headers (or write them on first Google Form submission)
  const lastCol = sheet.getLastColumn();
  let headers;
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    headers = [
      "Timestamp",
      "username",
      "memberType",
      ...Object.values(fieldMap),
    ];
    sheet.appendRow(headers);
  } else {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  // Build row in header order
  const row = headers.map((h) => {
    if (h === "Timestamp") return new Date();
    if (h === "username") return "google-form";
    if (h === "memberType") return "unverified";
    return data[h] ?? "";
  });

  const lock = acquireScriptLock();
  if (!lock) return;
  try {
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}
