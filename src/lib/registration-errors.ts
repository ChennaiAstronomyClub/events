export type RegistrationErrorCode =
  | "full"
  | "duplicate"
  | "hold_expired"
  | "hold_required"
  | "registration_not_open"
  | "registration_closed"
  | "event_over"
  | "timeout"
  | string;

/** Safe to retry — idempotent reads/reserve refresh. */
export function isRetriableError(error?: string): boolean {
  return error === "timeout";
}

export function isHoldExpiredError(error?: string): boolean {
  return error === "hold_expired";
}

export function isHoldRequiredError(error?: string): boolean {
  return error === "hold_required";
}

export function registrationErrorMessage(
  error?: string,
  message?: string | null
): string {
  if (message) return message;
  switch (error) {
    case "hold_expired":
      return "Your 5-minute payment window has expired. Please reserve a seat again.";
    case "hold_required":
      return "Your seat reservation was not found. Please reserve a seat before submitting.";
    case "Registration not found":
      return "We couldn't find your registration for this event. Please log in with the same account you used to register.";
    case "event_over":
      return "This event has ended.";
    case "registration_not_open":
      return "Registration is not yet open.";
    case "registration_closed":
      return "Registration for this event has closed.";
    case "timeout":
      return "The request timed out. Please check your connection and try again.";
    case "missing_discourse_user":
      return "Your session could not be verified. Please log out, log in again, and retry.";
    case "sheets_config_error":
    case "sheets_auth_error":
    case "sheets_permission":
    case "sheets_not_found":
    case "sheets_api_error":
      return "Registration is temporarily unavailable. Please try again in a few minutes.";
    default:
      return error ?? "Something went wrong. Please try again.";
  }
}
