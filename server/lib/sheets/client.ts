import { google, type sheets_v4 } from "googleapis";
import type { GoogleAuth } from "google-auth-library";
import { SheetsConfigError } from "./errors.js";

let sheetsClient: sheets_v4.Sheets | null = null;
let authClient: GoogleAuth | null = null;
let warmPromise: Promise<void> | null = null;

function parseServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      const detail =
        parseErr instanceof SyntaxError ? parseErr.message : "invalid JSON";
      throw new SheetsConfigError(
        `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (${detail}). ` +
          "Paste the entire downloaded key file as one line, or use GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY instead."
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new SheetsConfigError(
        "GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON object with client_email and private_key."
      );
    }

    const creds = parsed as { client_email?: string; private_key?: string };
    if (!creds.client_email?.trim() || !creds.private_key?.trim()) {
      throw new SheetsConfigError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key."
      );
    }
    return {
      client_email: creds.client_email.trim(),
      private_key: creds.private_key.replace(/\\n/g, "\n"),
    };
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey?.trim()) {
    throw new SheetsConfigError(
      "Set GOOGLE_SERVICE_ACCOUNT_JSON, or both GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY."
    );
  }
  return { client_email: clientEmail, private_key: privateKey };
}

function getAuth(): GoogleAuth {
  if (!authClient) {
    const credentials = parseServiceAccount();
    authClient = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return authClient;
}

export function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) {
    throw new SheetsConfigError("GOOGLE_SHEETS_SPREADSHEET_ID is not set.");
  }
  return id;
}

export function isSheetsApiConfigured(): boolean {
  const hasCreds =
    Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) ||
    (Boolean(process.env.GOOGLE_CLIENT_EMAIL?.trim()) &&
      Boolean(process.env.GOOGLE_PRIVATE_KEY?.trim()));
  return Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() && hasCreds);
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (!sheetsClient) {
    sheetsClient = google.sheets({ version: "v4", auth: getAuth() });
  }
  return sheetsClient;
}

/** Prefetch OAuth token so the first registration request avoids JWT cold-start latency. */
export function warmSheetsClient(): Promise<void> {
  if (!isSheetsApiConfigured()) return Promise.resolve();
  if (!warmPromise) {
    warmPromise = getAuth()
      .getAccessToken()
      .then(() => {
        getSheetsClient();
      })
      .catch((err) => {
        warmPromise = null;
        throw err;
      });
  }
  return warmPromise;
}

/** Clear cached client (e.g. after tests); production instances reset on cold start. */
export function resetSheetsClient(): void {
  sheetsClient = null;
  authClient = null;
  warmPromise = null;
}

if (isSheetsApiConfigured()) {
  void warmSheetsClient().catch(() => undefined);
}
