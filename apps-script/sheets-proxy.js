/**
 * Google Apps Script — Spreadsheet-bound script for receiving form submissions
 * and appending to Google Sheets.
 *
 * This script handles TWO submission sources:
 *   1. React app  — via doPost() web-app endpoint
 *   2. Google Form — via onFormSubmit() spreadsheet trigger
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
 */

// ---- CONFIGURATION ----
var SHARED_SECRET = "9f201af7a3ac8dc296481909bacc9242";

// Maximum payload size (bytes). Rejects oversized requests early.
var MAX_PAYLOAD_BYTES = 50000; // ~50 KB
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
 */
function sanitizeCell(value) {
  if (typeof value !== "string") return value;
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value; // prefix with single-quote to force text
  }
  return value;
}

// ---- WEB APP ENDPOINTS ----

function doPost(e) {
  try {
    // Guard against oversized payloads
    var raw = e.postData.contents;
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ success: false, error: "Payload too large" });
    }

    var data = JSON.parse(raw);

    // Authenticate
    if (data.secret !== SHARED_SECRET) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = data.sheetTab || "Sheet1";

    // Whitelist sheet-tab names: alphanumeric, spaces, hyphens only
    if (!/^[\w\s-]+$/.test(sheetName)) {
      return jsonResponse({ success: false, error: "Invalid sheet name" });
    }

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // Build row data — exclude internal fields
    var exclude = ["secret", "sheetTab"];
    var keys = [];
    var values = [];

    keys.push("Timestamp");
    values.push(new Date());

    for (var key in data) {
      if (data.hasOwnProperty(key) && exclude.indexOf(key) === -1) {
        keys.push(key);
        values.push(sanitizeCell(data[key]));
      }
    }

    // Acquire lock BEFORE duplicate check to prevent race conditions
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      // ---- DUPLICATE CHECK (by email) ----
      var email = data.email;
      if (email) {
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          var emailColIndex = -1;
          for (var i = 0; i < headers.length; i++) {
            if (headers[i] === "email") {
              emailColIndex = i + 1;
              break;
            }
          }

          if (emailColIndex > 0) {
            var emailValues = sheet.getRange(2, emailColIndex, lastRow - 1, 1).getValues();
            for (var j = 0; j < emailValues.length; j++) {
              if (String(emailValues[j][0]).toLowerCase() === String(email).toLowerCase()) {
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

      // Write headers on first submission
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
    return jsonResponse({ success: false, error: error.toString() });
  }
}

function doGet() {
  return jsonResponse({ status: "ok", message: "Sheets proxy is running" });
}

// ---- GOOGLE FORM CONSOLIDATION ----

/**
 * Map Google Form question titles → React-app column keys.
 * Update this whenever you change Google Form questions.
 */
var FORM_FIELD_MAP = {
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
  "Smoking, consuming alcohol and other anti-social behavior are strictly prohibited": "conductCode",
  "Disclaimer - Travelling by road involves inherent dangers including but not limited to accidents. CAC and its organizers are not responsible for any accidents or injuries during the event. CAC and organizers are not responsible for any loss or damage to personal property. The participant agrees to take full responsibility on the above": "riskDisclaimer",
  "Anything else that you would like to ask the CAC team?": "additionalQuestions",
};
var FORM_SHEET_TAB = "Entries";

/**
 * Installable trigger for Google Form submissions (spreadsheet-bound).
 *
 * The spreadsheet trigger provides e.namedValues (question title → [answers])
 * rather than the Form trigger's e.response.getItemResponses().
 */
function onFormSubmit(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_TAB);

  if (!sheet) {
    sheet = ss.insertSheet(FORM_SHEET_TAB);
  }

  var namedValues = e.namedValues || {};
  var data = {};

  for (var title in namedValues) {
    if (!namedValues.hasOwnProperty(title)) continue;
    var key = FORM_FIELD_MAP[title];
    if (key) {
      var answers = namedValues[title];
      var filtered = [];
      for (var i = 0; i < answers.length; i++) {
        if (answers[i] !== "") filtered.push(sanitizeCell(answers[i]));
      }
      data[key] = filtered.join(", ");
    }
  }

  // Read existing headers
  var lastCol = sheet.getLastColumn();
  var headers;
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    headers = ["Timestamp", "username", "memberType"];
    var allKeys = Object.keys(FORM_FIELD_MAP).map(function (t) {
      return FORM_FIELD_MAP[t];
    });
    headers = headers.concat(allKeys);
    sheet.appendRow(headers);
  } else {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  // Build row in header order
  var row = [];
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === "Timestamp") row.push(new Date());
    else if (h === "username") row.push("google-form");
    else if (h === "memberType") row.push("unverified");
    else row.push(data[h] || "");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  sheet.appendRow(row);
  lock.releaseLock();
}
