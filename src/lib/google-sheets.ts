/** Timeout for form submissions (ms) */
const SUBMIT_TIMEOUT_MS = 15_000;

export interface SubmitResult {
  success: boolean;
  row?: number;
  error?: string;
  message?: string;
}

export interface RegistrationStatusResult {
  success: boolean;
  hasLimit?: boolean;
  limit?: number | null;
  activeRegistrations?: number;
  isFull?: boolean;
  error?: string;
  message?: string;
}

export interface RegistrationReserveResult {
  success: boolean;
  hasLimit?: boolean;
  limit?: number | null;
  activeRegistrations?: number;
  isFull?: boolean;
  expiresAt?: string;
  row?: number;
  error?: string;
  message?: string;
}

/** Shared fetch helper for server-side registration API. */
async function callRegistrationsApi<T>(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const response = await fetch("/api/registrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Api-Key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `Server error: ${response.status}` } as T;
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Request timed out. Please try again." } as T;
    }
    const message = err instanceof Error ? err.message : "Network error";
    return { success: false, error: message } as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST form data to the Google Apps Script proxy.
 *
 * Uses Content-Type: text/plain to avoid a CORS preflight request
 * (Apps Script doesn't support OPTIONS). The body is still JSON.
 */
export async function submitToSheets(
  sheetTab: string,
  formData: Record<string, unknown>,
  apiKey: string,
  options?: { formId?: string; requiresPayment?: boolean }
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(apiKey, {
    action: "submit",
    sheetTab,
    formData,
    formId: options?.formId ?? "",
    requiresPayment: Boolean(options?.requiresPayment),
  });
}

/**
 * Soft-cancel a registration by email.
 * Sets the "Status" column to "Cancelled" for the matching active row.
 */
export async function cancelRegistration(
  sheetTab: string,
  apiKey: string
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(apiKey, {
    action: "cancel",
    sheetTab,
  });
}

/**
 * Update specific fields of an existing registration.
 * Pass an object of { columnKey: newValue } pairs in `updates`.
 * Also records an "UpdatedAt" timestamp on the row.
 */
export async function updateRegistration(
  sheetTab: string,
  apiKey: string,
  updates: Record<string, unknown>
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(apiKey, {
    action: "update",
    sheetTab,
    updates,
  });
}

/**
 * Read registration capacity status for a sheet before submission.
 */
export async function getRegistrationStatusForSheet(
  sheetTab: string,
  apiKey: string
): Promise<RegistrationStatusResult> {
  return callRegistrationsApi<RegistrationStatusResult>(apiKey, {
    action: "status",
    sheetTab,
  });
}

/**
 * Reserve a temporary seat hold for payment flows.
 */
export async function reserveRegistrationSlot(
  sheetTab: string,
  apiKey: string,
  options?: { formId?: string; requiresPayment?: boolean; reserveFields?: string[] }
): Promise<RegistrationReserveResult> {
  return callRegistrationsApi<RegistrationReserveResult>(apiKey, {
    action: "reserve",
    sheetTab,
    formId: options?.formId ?? "",
    requiresPayment: Boolean(options?.requiresPayment),
    reserveFields: Array.isArray(options?.reserveFields) ? options?.reserveFields : [],
  });
}
