/** Misconfigured or invalid Google Sheets credentials / env. */
export class SheetsConfigError extends Error {
  readonly code = "sheets_config_error";

  constructor(message: string) {
    super(message);
    this.name = "SheetsConfigError";
  }
}

export interface SheetsApiErrorResponse {
  status: number;
  body: {
    success: false;
    error: string;
    message: string;
  };
}

export function mapSheetsError(err: unknown): SheetsApiErrorResponse {
  if (err instanceof SheetsConfigError) {
    return {
      status: 500,
      body: { success: false, error: err.code, message: err.message },
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid_grant") ||
    lower.includes("invalid jwt") ||
    lower.includes("not a valid")
  ) {
    return {
      status: 500,
      body: {
        success: false,
        error: "sheets_auth_error",
        message:
          "Google Sheets credentials are invalid. Check GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_PRIVATE_KEY in server environment variables.",
      },
    };
  }

  if (lower.includes("requested entity was not found") || lower.includes("not found")) {
    return {
      status: 500,
      body: {
        success: false,
        error: "sheets_not_found",
        message:
          "Spreadsheet not found. Check GOOGLE_SHEETS_SPREADSHEET_ID and that the sheet is shared with the service account.",
      },
    };
  }

  if (
    lower.includes("permission") ||
    lower.includes("caller does not have permission") ||
    lower.includes("403")
  ) {
    return {
      status: 500,
      body: {
        success: false,
        error: "sheets_permission",
        message:
          "The service account cannot edit this spreadsheet. Share the sheet with the service account email as Editor.",
      },
    };
  }

  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: number }).code;
    if (code === 403) {
      return {
        status: 500,
        body: {
          success: false,
          error: "sheets_permission",
          message:
            "The service account cannot access this spreadsheet. Share the sheet with the service account email as Editor.",
        },
      };
    }
    if (code === 404) {
      return {
        status: 500,
        body: {
          success: false,
          error: "sheets_not_found",
          message: "Spreadsheet or sheet tab not found. Check GOOGLE_SHEETS_SPREADSHEET_ID.",
        },
      };
    }
  }

  return {
    status: 500,
    body: {
      success: false,
      error: "sheets_api_error",
      message:
        "Could not reach the registration spreadsheet. Please try again in a moment.",
    },
  };
}
