import { APPS_SCRIPT_URL, SHEETS_SECRET } from "./env";

/** Timeout for form submissions (ms) */
const SUBMIT_TIMEOUT_MS = 15_000;

export interface SubmitResult {
  success: boolean;
  row?: number;
  error?: string;
  message?: string;
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
  username: string,
  memberType: string
): Promise<SubmitResult> {
  const payload = {
    secret: SHEETS_SECRET,
    sheetTab,
    username,
    memberType,
    ...formData,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `Server error: ${response.status}` };
    }

    return await response.json();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Request timed out. Please try again." };
    }
    const message = err instanceof Error ? err.message : "Network error";
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
