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
  "May 31 Entries": 18,
};
const PENDING_SEAT_HOLD_MS = 5 * 60 * 1000; // 5 minutes
// ---- END CONFIGURATION ----

// ---- HELPERS ----

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
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
  const idx = headers.indexOf(name);
  return idx === -1 ? -1 : idx + 1;
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
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function isPaymentRequired(value) {
  return value === true || String(value).trim().toLowerCase() === "true";
}

function ensurePaymentColumns(sheet) {
  ensureColumn(sheet, "RequiresPayment");
  ensureColumn(sheet, "PaymentStatus");
  ensureColumn(sheet, "PaymentStatusUpdatedAt");
  ensureColumn(sheet, "SeatStatus");
  ensureColumn(sheet, "PaidAt");
}

/**
 * Decide whether a row should be treated as a real registration.
 * Prefer a non-empty email column when available; otherwise require at least
 * one non-empty non-metadata cell.
 */
function isMeaningfulRegistrationRow(headers, rowValues) {
  const emailIndex = headers.indexOf("email");
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
  const emailValues = sheet.getRange(2, emailCol, numRows, 1).getValues();
  const statusValues =
    statusCol > 0 ? sheet.getRange(2, statusCol, numRows, 1).getValues() : null;

  for (let j = 0; j < emailValues.length; j++) {
    if (statusValues?.[j][0] === "Cancelled") continue;
    if (String(emailValues[j][0]).toLowerCase() === String(email).toLowerCase()) {
      return j + 2; // 1-based (row 1 = headers, row 2 = first data row)
    }
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

function writeKeyedRow(sheet, rowIndex, keys, values) {
  for (let i = 0; i < keys.length; i++) {
    const colIndex = ensureColumn(sheet, keys[i]);
    sheet.getRange(rowIndex, colIndex).setValue(values[i]);
  }
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

function findHoldStartForRow(sheet, rowIndex) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const paymentUpdatedAtCol = findColumnIndex(headers, "PaymentStatusUpdatedAt");
  const timestampCol = findColumnIndex(headers, "Timestamp");

  const paymentUpdatedAt =
    paymentUpdatedAtCol > 0 ? parseSheetDate(sheet.getRange(rowIndex, paymentUpdatedAtCol).getValue()) : null;
  const createdAt = timestampCol > 0 ? parseSheetDate(sheet.getRange(rowIndex, timestampCol).getValue()) : null;
  return paymentUpdatedAt || createdAt;
}

/**
 * Count active (non-cancelled) registrations in the sheet.
 */
function countActiveRegistrations(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return 0;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const statusCol = findColumnIndex(headers, "Status");
  const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findColumnIndex(headers, "PaymentStatusUpdatedAt");
  const requiresPaymentCol = findColumnIndex(headers, "RequiresPayment");
  const timestampCol = findColumnIndex(headers, "Timestamp");
  const numRows = lastRow - 1;
  const allRows = sheet.getRange(2, 1, numRows, lastCol).getValues();

  const nowMs = Date.now();
  return allRows.reduce((count, rowValues) => {
    // Cancelled entries never consume capacity.
    if (statusCol > 0 && rowValues[statusCol - 1] === "Cancelled") return count;
    // Ignore blank/incomplete rows so they cannot block registrations.
    if (!isMeaningfulRegistrationRow(headers, rowValues)) return count;

    // Legacy rows (before PaymentStatus) count as active registrations.
    if (paymentStatusCol < 0) return count + 1;

    if (requiresPaymentCol > 0 && !isPaymentRequired(rowValues[requiresPaymentCol - 1])) {
      return count + 1;
    }

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol - 1]);
    if (paymentStatus === "Paid") return count + 1;
    if (paymentStatus !== "Pending") return count;

    const paymentUpdatedAt =
      paymentUpdatedAtCol > 0 ? parseSheetDate(rowValues[paymentUpdatedAtCol - 1]) : null;
    const createdAt = timestampCol > 0 ? parseSheetDate(rowValues[timestampCol - 1]) : null;
    const holdStart = paymentUpdatedAt || createdAt;
    if (!holdStart) return count;

    return nowMs - holdStart.getTime() < PENDING_SEAT_HOLD_MS ? count + 1 : count;
  }, 0);
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
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return 0;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const statusCol = findColumnIndex(headers, "Status");
  const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
  const paymentUpdatedAtCol = findColumnIndex(headers, "PaymentStatusUpdatedAt");
  const requiresPaymentCol = findColumnIndex(headers, "RequiresPayment");
  const timestampCol = findColumnIndex(headers, "Timestamp");
  if (paymentStatusCol < 0) return 0;

  const now = new Date();
  const nowMs = now.getTime();
  const numRows = lastRow - 1;
  const allRows = sheet.getRange(2, 1, numRows, lastCol).getValues();
  const toExpire = [];

  for (let i = 0; i < allRows.length; i++) {
    const rowValues = allRows[i];
    if (statusCol > 0 && rowValues[statusCol - 1] === "Cancelled") continue;
    if (!isMeaningfulRegistrationRow(headers, rowValues)) continue;
    if (requiresPaymentCol > 0 && !isPaymentRequired(rowValues[requiresPaymentCol - 1])) continue;

    const paymentStatus = normalizePaymentStatus(rowValues[paymentStatusCol - 1]);
    if (paymentStatus !== "Pending") continue;

    const paymentUpdatedAt =
      paymentUpdatedAtCol > 0 ? parseSheetDate(rowValues[paymentUpdatedAtCol - 1]) : null;
    const createdAt = timestampCol > 0 ? parseSheetDate(rowValues[timestampCol - 1]) : null;
    const holdStart = paymentUpdatedAt || createdAt;
    if (!holdStart) continue;

    if (nowMs - holdStart.getTime() >= PENDING_SEAT_HOLD_MS) {
      toExpire.push(i + 2);
    }
  }

  if (toExpire.length === 0) return 0;

  const seatStatusCol = ensureColumn(sheet, "SeatStatus");
  for (const rowIndex of toExpire) {
    sheet.getRange(rowIndex, paymentStatusCol).setValue("Expired");
    if (paymentUpdatedAtCol > 0) {
      sheet.getRange(rowIndex, paymentUpdatedAtCol).setValue(now);
    }
    sheet.getRange(rowIndex, seatStatusCol).setValue("Expired");
  }

  return toExpire.length;
}

/**
 * Return current capacity state for a sheet.
 */
function handleStatus(sheetName, sheet) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensurePaymentColumns(sheet);
    expireStalePendingRows(sheet);
    const limit = REGISTRATION_LIMITS[sheetName];
    const activeRegistrations = countActiveRegistrations(sheet);
    const hasLimit = typeof limit === "number";
    const isFull = hasLimit ? activeRegistrations >= limit : false;

    return jsonResponse({
      success: true,
      hasLimit,
      limit: hasLimit ? limit : null,
      activeRegistrations,
      isFull,
      message: isFull
        ? "Registrations are paused because the event is full. Please contact the organisers if you wish to register."
        : "",
    });
  } finally {
    lock.releaseLock();
  }
}

function handleReserve(data, sheetName, sheet) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });
  if (!isPaymentRequired(data.requiresPayment)) {
    return handleStatus(sheetName, sheet);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensurePaymentColumns(sheet);
    expireStalePendingRows(sheet);

    const limit = REGISTRATION_LIMITS[sheetName];
    if (typeof limit === "number" && countActiveRegistrations(sheet) >= limit) {
      return jsonResponse({
        success: false,
        error: "full",
        message: "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
      });
    }

    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const activeRow = findActiveRowByEmail(sheet, email);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PENDING_SEAT_HOLD_MS).toISOString();

    if (activeRow > 0) {
      const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
      const paymentStatus =
        paymentStatusCol > 0 ? normalizePaymentStatus(sheet.getRange(activeRow, paymentStatusCol).getValue()) : "";

      if (paymentStatus === "Paid") {
        return jsonResponse({
          success: false,
          error: "duplicate",
          message: "This email has already been registered for this event.",
        });
      }

      const holdStart = findHoldStartForRow(sheet, activeRow);
      const holdStillValid = holdStart && now.getTime() - holdStart.getTime() < PENDING_SEAT_HOLD_MS;
      if (paymentStatus === "Pending" && holdStillValid) {
        return jsonResponse({ success: true, row: activeRow, expiresAt });
      }

      const requiresPaymentCol = ensureColumn(sheet, "RequiresPayment");
      const paymentStatusUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
      const seatStatusCol = ensureColumn(sheet, "SeatStatus");
      sheet.getRange(activeRow, requiresPaymentCol).setValue("true");
      sheet.getRange(activeRow, paymentStatusCol).setValue("Pending");
      sheet.getRange(activeRow, paymentStatusUpdatedAtCol).setValue(now);
      sheet.getRange(activeRow, seatStatusCol).setValue("Pending");
      return jsonResponse({ success: true, row: activeRow, expiresAt });
    }

    const reserveFields = Array.isArray(data.reserveFields)
      ? data.reserveFields.filter(function (field) {
          return typeof field === "string" && field.trim() !== "";
        })
      : [];

    const reservePayload = {
      username: data.username || "",
      memberType: data.memberType || "",
      email,
      formId: data.formId || "",
      requiresPayment: "true",
    };
    for (let i = 0; i < reserveFields.length; i++) {
      if (!(reserveFields[i] in reservePayload)) {
        reservePayload[reserveFields[i]] = "";
      }
    }
    const keys = ["Timestamp"];
    const values = [now];
    for (const key of Object.keys(reservePayload)) {
      keys.push(sanitizeCell(String(key)));
      values.push(sanitizeCell(reservePayload[key]));
    }

    const appendedRow = Math.max(sheet.getLastRow(), 1) + 1;
    writeKeyedRow(sheet, appendedRow, keys, values);
    const requiresPaymentCol = ensureColumn(sheet, "RequiresPayment");
    const paymentStatusCol = ensureColumn(sheet, "PaymentStatus");
    const paymentStatusUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
    const seatStatusCol = ensureColumn(sheet, "SeatStatus");
    sheet.getRange(appendedRow, requiresPaymentCol).setValue("true");
    sheet.getRange(appendedRow, paymentStatusCol).setValue("Pending");
    sheet.getRange(appendedRow, paymentStatusUpdatedAtCol).setValue(now);
    sheet.getRange(appendedRow, seatStatusCol).setValue("Pending");

    return jsonResponse({ success: true, row: appendedRow, expiresAt });
  } finally {
    lock.releaseLock();
  }
}

// ---- ACTION HANDLERS ----

/**
 * Soft-delete a registration by setting its Status column to "Cancelled".
 * Identified by email address.
 */
function handleCancel(data, sheet) {
  const email = data.email;
  if (!email) return jsonResponse({ success: false, error: "Missing email" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rowIndex = findActiveRowByEmail(sheet, email);
    if (rowIndex < 0) {
      lock.releaseLock();
      return jsonResponse({ success: false, error: "Registration not found" });
    }

    const statusCol = ensureColumn(sheet, "Status");
    sheet.getRange(rowIndex, statusCol).setValue("Cancelled");
    lock.releaseLock();
    return jsonResponse({ success: true });
  } catch (err) {
    lock.releaseLock();
    return jsonResponse({ success: false, error: String(err) });
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

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rowIndex = findActiveRowByEmail(sheet, email);
    if (rowIndex < 0) {
      lock.releaseLock();
      return jsonResponse({ success: false, error: "Registration not found" });
    }

    let nextPaymentStatus = "";
    for (const key of Object.keys(updates)) {
      const colIndex = ensureColumn(sheet, key);
      if (key === "PaymentStatus") {
        nextPaymentStatus = normalizePaymentStatus(updates[key]);
        if (!nextPaymentStatus) continue;
        sheet.getRange(rowIndex, colIndex).setValue(nextPaymentStatus);
      } else {
        sheet.getRange(rowIndex, colIndex).setValue(sanitizeCell(String(updates[key])));
      }
    }

    if (nextPaymentStatus) {
      const paymentUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
      sheet.getRange(rowIndex, paymentUpdatedAtCol).setValue(new Date());
      updateSeatStatusForPayment(sheet, rowIndex, nextPaymentStatus, data.sheetTab || "Sheet1");
    }

    const updatedAtCol = ensureColumn(sheet, "UpdatedAt");
    sheet.getRange(rowIndex, updatedAtCol).setValue(new Date());

    lock.releaseLock();
    return jsonResponse({ success: true });
  } catch (err) {
    lock.releaseLock();
    return jsonResponse({ success: false, error: String(err) });
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
    if (action === "cancel") return handleCancel(data, sheet);
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

    // Acquire lock BEFORE duplicate check to prevent race conditions
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      ensurePaymentColumns(sheet);
      const email = data.email;
      const requiresPayment = isPaymentRequired(data.requiresPayment);
      const limit = REGISTRATION_LIMITS[sheetName];
      expireStalePendingRows(sheet);

      if (requiresPayment && email) {
        const existingRow = findActiveRowByEmail(sheet, email);
        if (existingRow > 0) {
          const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          const paymentStatusCol = findColumnIndex(headers, "PaymentStatus");
          const paymentStatus =
            paymentStatusCol > 0
              ? normalizePaymentStatus(sheet.getRange(existingRow, paymentStatusCol).getValue())
              : "";
          const holdStart = findHoldStartForRow(sheet, existingRow);
          const holdStillValid =
            holdStart && new Date().getTime() - holdStart.getTime() < PENDING_SEAT_HOLD_MS;

          if (paymentStatus === "Pending" && holdStillValid) {
            for (let k = 0; k < keys.length; k++) {
              const colIdx = ensureColumn(sheet, keys[k]);
              sheet.getRange(existingRow, colIdx).setValue(values[k]);
            }
            const requiresPaymentCol = ensureColumn(sheet, "RequiresPayment");
            const paymentStatusUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
            const paidAtCol = ensureColumn(sheet, "PaidAt");
            sheet.getRange(existingRow, requiresPaymentCol).setValue("true");
            sheet.getRange(existingRow, paymentStatusCol).setValue("Paid");
            sheet.getRange(existingRow, paymentStatusUpdatedAtCol).setValue(new Date());
            sheet.getRange(existingRow, paidAtCol).setValue(new Date());
            updateSeatStatusForPayment(sheet, existingRow, "Paid", sheetName);
            lock.releaseLock();
            return jsonResponse({ success: true, row: existingRow });
          }

          if (paymentStatus === "Pending" && !holdStillValid) {
            lock.releaseLock();
            return jsonResponse({
              success: false,
              error: "hold_expired",
              message: "Your 5-minute payment window has expired. Please try again.",
            });
          }

          lock.releaseLock();
          return jsonResponse({
            success: false,
            error: "duplicate",
            message: "This email has already been registered for this event.",
          });
        }
      }

      // ---- DUPLICATE CHECK (by email, skipping cancelled rows) ----
      if (email && findActiveRowByEmail(sheet, email) > 0) {
        lock.releaseLock();
        return jsonResponse({
          success: false,
          error: "duplicate",
          message: "This email has already been registered for this event.",
        });
      }
      // ---- END DUPLICATE CHECK ----

      // ---- CAPACITY CHECK ----
      if (typeof limit === "number" && countActiveRegistrations(sheet) >= limit) {
        lock.releaseLock();
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
          for (let k = 0; k < keys.length; k++) {
            const colIdx = ensureColumn(sheet, keys[k]);
            sheet.getRange(cancelledRow, colIdx).setValue(values[k]);
          }
          // Clear the Status column so the row is active again
          const statusCol = ensureColumn(sheet, "Status");
          sheet.getRange(cancelledRow, statusCol).setValue("");
          const requiresPaymentCol = ensureColumn(sheet, "RequiresPayment");
          const paymentStatusCol = ensureColumn(sheet, "PaymentStatus");
          const paymentStatusUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
          const seatStatusCol = ensureColumn(sheet, "SeatStatus");
          const paidAtCol = ensureColumn(sheet, "PaidAt");
          sheet.getRange(cancelledRow, requiresPaymentCol).setValue(
            requiresPayment ? "true" : "false"
          );
          sheet.getRange(cancelledRow, paymentStatusCol).setValue(
            "Paid"
          );
          sheet.getRange(cancelledRow, paymentStatusUpdatedAtCol).setValue(new Date());
          sheet.getRange(cancelledRow, seatStatusCol).setValue(
            "Confirmed"
          );
          sheet.getRange(cancelledRow, paidAtCol).setValue(new Date());
          lock.releaseLock();
          return jsonResponse({ success: true, row: cancelledRow });
        }
      }

      const appendedRow = Math.max(sheet.getLastRow(), 1) + 1;
      writeKeyedRow(sheet, appendedRow, keys, values);
      const requiresPaymentCol = ensureColumn(sheet, "RequiresPayment");
      const paymentStatusCol = ensureColumn(sheet, "PaymentStatus");
      const paymentStatusUpdatedAtCol = ensureColumn(sheet, "PaymentStatusUpdatedAt");
      const seatStatusCol = ensureColumn(sheet, "SeatStatus");
      const paidAtCol = ensureColumn(sheet, "PaidAt");
      sheet.getRange(appendedRow, requiresPaymentCol).setValue(
        requiresPayment ? "true" : "false"
      );
      sheet.getRange(appendedRow, paymentStatusCol).setValue(
        "Paid"
      );
      sheet.getRange(appendedRow, paymentStatusUpdatedAtCol).setValue(new Date());
      sheet.getRange(appendedRow, seatStatusCol).setValue(
        "Confirmed"
      );
      sheet.getRange(appendedRow, paidAtCol).setValue(new Date());
      lock.releaseLock();

      return jsonResponse({ success: true, row: appendedRow });
    } catch (innerError) {
      lock.releaseLock();
      throw innerError;
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

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  sheet.appendRow(row);
  lock.releaseLock();
}
