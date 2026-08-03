import { REGISTRATION_API_TIMEOUT_MS } from "@/lib/api-timeouts";
import { isRetriableError } from "@/lib/registration-errors";
import {
  getRegistrationDiscourseUser,
} from "@/lib/registration-discourse";
import { withReserveDedupe } from "@/lib/reserve-dedupe";
import type { DiscourseUser } from "@/types/discourse";

const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 800;

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
  holdToken?: string;
  row?: number;
  error?: string;
  message?: string;
}

export interface GuestUser {
  email: string;
}

export interface RegistrationCallOptions {
  formId: string;
  apiKey?: string;
  user?: DiscourseUser | null;
  guestUser?: GuestUser;
  holdToken?: string;
  /** Optional phone for registration whitelist matching on the server. */
  phone?: string;
  /** Optional email for guest whitelist invite matching (no Discourse session). */
  email?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDiscourseUser(
  payload: Record<string, unknown>,
  user?: DiscourseUser | null
): Record<string, unknown> {
  const discourseUser = getRegistrationDiscourseUser(user);
  if (!discourseUser) return payload;
  return { ...payload, discourseUser };
}

function enrichGuestPayload(
  payload: Record<string, unknown>,
  options?: Pick<RegistrationCallOptions, "guestUser" | "holdToken">
): Record<string, unknown> {
  let body = { ...payload };
  if (options?.guestUser) {
    body = { ...body, guestUser: options.guestUser };
  }
  if (options?.holdToken) {
    body = { ...body, holdToken: options.holdToken };
  }
  return body;
}

/** Shared fetch helper for server-side registration API. */
async function callRegistrationsApiOnce<T>(
  payload: Record<string, unknown>,
  options?: RegistrationCallOptions,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRATION_API_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      return {
        success: false,
        error: "timeout",
        message: "Request was cancelled.",
      } as T;
    }
    externalSignal.addEventListener("abort", onExternalAbort);
  }

  let body = withDiscourseUser(payload, options?.user);
  body = enrichGuestPayload(body, options);
  if (options?.phone?.trim()) {
    body = { ...body, phone: options.phone.trim() };
  }
  if (options?.email?.trim()) {
    body = { ...body, email: options.email.trim() };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.apiKey) {
    headers["User-Api-Key"] = options.apiKey;
  }

  try {
    const response = await fetch("/api/registrations", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const resBody = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      return {
        success: false,
        error: resBody?.error ?? `Server error: ${response.status}`,
        message: resBody?.message,
      } as T;
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: "timeout",
        message: "Request timed out. Please try again.",
      } as T;
    }
    const message = err instanceof Error ? err.message : "Network error";
    return { success: false, error: message } as T;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function callRegistrationsApi<T>(
  payload: Record<string, unknown>,
  options: RegistrationCallOptions
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    last = await callRegistrationsApiOnce<T>(payload, options);
    const error = (last as { error?: string }).error;
    if (!isRetriableError(error) || attempt === RETRY_ATTEMPTS) {
      return last;
    }
    await delay(RETRY_BASE_MS * (attempt + 1));
  }
  return last as T;
}

export async function checkRegistrationWhitelist(
  formId: string,
  options: RegistrationCallOptions
): Promise<{ success: boolean; allowed?: boolean; error?: string; message?: string }> {
  return callRegistrationsApiOnce(
    {
      action: "whitelistCheck",
      formId,
    },
    options
  );
}

export async function submitToSheets(
  sheetTab: string,
  formData: Record<string, unknown>,
  options: RegistrationCallOptions & {
    requiresPayment?: boolean;
  }
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    {
      action: "submit",
      sheetTab,
      formData,
      formId: options.formId,
      requiresPayment: Boolean(options.requiresPayment),
    },
    options
  );
}

export async function cancelRegistration(
  sheetTab: string,
  options: RegistrationCallOptions
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    { action: "cancel", sheetTab, formId: options.formId },
    options
  );
}

/** Fire-and-forget: delete expired Pending hold row (no retries, survives navigation). */
export function releaseExpiredHold(
  sheetTab: string,
  options: RegistrationCallOptions
): void {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const body = enrichGuestPayload(
    withDiscourseUser({ action: "releaseHold", sheetTab, formId: options.formId }, options.user),
    options
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apiKey) {
    headers["User-Api-Key"] = options.apiKey;
  }
  void fetch("/api/registrations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
    keepalive: true,
  }).finally(() => clearTimeout(timeout));
}

export async function updateRegistration(
  sheetTab: string,
  updates: Record<string, unknown>,
  options: RegistrationCallOptions
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    { action: "update", sheetTab, updates, formId: options.formId },
    options
  );
}

export async function getRegistrationStatusForSheet(
  sheetTab: string,
  options: RegistrationCallOptions
): Promise<RegistrationStatusResult> {
  return callRegistrationsApi<RegistrationStatusResult>(
    { action: "status", sheetTab, formId: options.formId },
    options
  );
}

/**
 * Reserve a seat hold. Retries only on lock contention (busy), not on timeout —
 * a timed-out request may still have created the hold row on the server.
 */
export async function reserveRegistrationSlot(
  sheetTab: string,
  options: RegistrationCallOptions & {
    requiresPayment?: boolean;
    signal?: AbortSignal;
  }
): Promise<RegistrationReserveResult> {
  const formId = options.formId;
  const email =
    options.user?.email?.trim() ?? options.guestUser?.email?.trim() ?? "";
  const run = async (): Promise<RegistrationReserveResult> => {
    return callRegistrationsApiOnce<RegistrationReserveResult>(
      {
        action: "reserve",
        sheetTab,
        formId,
        requiresPayment: Boolean(options.requiresPayment),
        reserveFields: [],
      },
      options,
      options.signal
    );
  };

  if (formId && email) {
    return withReserveDedupe(formId, email, run);
  }
  return run();
}
