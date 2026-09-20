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
  const genericMessage =
    "Registration is temporarily unavailable. Please try again in a few minutes.";

  if (err instanceof SheetsConfigError) {
    return {
      status: 500,
      body: { success: false, error: err.code, message: genericMessage },
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
        message: genericMessage,
      },
    };
  }

  if (lower.includes("requested entity was not found") || lower.includes("not found")) {
    return {
      status: 500,
      body: {
        success: false,
        error: "sheets_not_found",
        message: genericMessage,
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
        message: genericMessage,
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
          message: genericMessage,
        },
      };
    }
    if (code === 404) {
      return {
        status: 500,
        body: {
          success: false,
          error: "sheets_not_found",
          message: genericMessage,
        },
      };
    }
  }

  return {
    status: 500,
    body: {
      success: false,
      error: "sheets_api_error",
      message: genericMessage,
    },
  };
}
