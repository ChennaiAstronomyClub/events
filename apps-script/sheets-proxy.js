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

    for (const key of Object.keys(updates)) {
      const colIndex = ensureColumn(sheet, key);
      sheet.getRange(rowIndex, colIndex).setValue(sanitizeCell(String(updates[key])));
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
      // ---- DUPLICATE CHECK (by email, skipping cancelled rows) ----
      const email = data.email;
      if (email) {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          const emailCol = findColumnIndex(headers, "email");
          const statusCol = findColumnIndex(headers, "Status");

          if (emailCol > 0) {
            const numRows = lastRow - 1;
            const emailValues = sheet.getRange(2, emailCol, numRows, 1).getValues();
            const statusValues =
              statusCol > 0
                ? sheet.getRange(2, statusCol, numRows, 1).getValues()
                : null;

            for (let j = 0; j < emailValues.length; j++) {
              // Skip cancelled rows — they are allowed to re-register
              if (statusValues?.[j][0] === "Cancelled") continue;
              if (
                String(emailValues[j][0]).toLowerCase() ===
                String(email).toLowerCase()
              ) {
                lock.releaseLock();
                return jsonResponse({
                  success: false,
                  error: "duplicate",
                  message: "This email has already been registered for this event.",
                });
              }
            }
          }
        }
      }
      // ---- END DUPLICATE CHECK ----

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
          lock.releaseLock();
          return jsonResponse({ success: true, row: cancelledRow });
        }
      }

      // No prior cancelled row — write headers on first submission and append
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(keys);
      }

      sheet.appendRow(values);
      lock.releaseLock();

      return jsonResponse({ success: true, row: sheet.getLastRow() });
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
