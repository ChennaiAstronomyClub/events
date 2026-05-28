import { REGISTRATION_API_TIMEOUT_MS } from "@/lib/api-timeouts";
import { isRetriableError } from "@/lib/registration-errors";
import {
  getRegistrationDiscourseUser,
  type RegistrationDiscourseUser,
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
  row?: number;
  error?: string;
  message?: string;
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

/** Shared fetch helper for server-side registration API. */
async function callRegistrationsApiOnce<T>(
  apiKey: string,
  payload: Record<string, unknown>,
  externalSignal?: AbortSignal,
  discourseUser?: RegistrationDiscourseUser
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

  const body = discourseUser ? { ...payload, discourseUser } : payload;

  try {
    const response = await fetch("/api/registrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Api-Key": apiKey,
      },
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

/**
 * Retries on lock contention or timeout. Reserve is idempotent — a retry after a
 * slow first request usually finds the existing Pending row and returns quickly.
 */
async function callRegistrationsApi<T>(
  apiKey: string,
  payload: Record<string, unknown>,
  user?: DiscourseUser | null
): Promise<T> {
  const enriched = withDiscourseUser(payload, user);
  const discourseUser = getRegistrationDiscourseUser(user);
  let last: T | undefined;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    last = await callRegistrationsApiOnce<T>(apiKey, enriched, undefined, discourseUser);
    const error = (last as { error?: string }).error;
    if (!isRetriableError(error) || attempt === RETRY_ATTEMPTS) {
      return last;
    }
    await delay(RETRY_BASE_MS * (attempt + 1));
  }
  return last as T;
}

export async function submitToSheets(
  sheetTab: string,
  formData: Record<string, unknown>,
  apiKey: string,
  options?: { formId?: string; requiresPayment?: boolean; user?: DiscourseUser | null }
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    apiKey,
    {
      action: "submit",
      sheetTab,
      formData,
      formId: options?.formId ?? "",
      requiresPayment: Boolean(options?.requiresPayment),
    },
    options?.user
  );
}

export async function cancelRegistration(
  sheetTab: string,
  apiKey: string,
  user?: DiscourseUser | null
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    apiKey,
    { action: "cancel", sheetTab },
    user
  );
}

/** Fire-and-forget: delete expired Pending hold row (no retries, survives navigation). */
export function releaseExpiredHold(
  sheetTab: string,
  apiKey: string,
  user?: DiscourseUser | null
): void {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const body = withDiscourseUser({ action: "releaseHold", sheetTab }, user);
  void fetch("/api/registrations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
    keepalive: true,
  }).finally(() => clearTimeout(timeout));
}

export async function updateRegistration(
  sheetTab: string,
  apiKey: string,
  updates: Record<string, unknown>,
  user?: DiscourseUser | null
): Promise<SubmitResult> {
  return callRegistrationsApi<SubmitResult>(
    apiKey,
    { action: "update", sheetTab, updates },
    user
  );
}

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
 * Reserve a seat hold. Retries only on lock contention (busy), not on timeout —
 * a timed-out request may still have created the hold row on the server.
 */
export async function reserveRegistrationSlot(
  sheetTab: string,
  apiKey: string,
  options?: {
    formId?: string;
    requiresPayment?: boolean;
    signal?: AbortSignal;
    user?: DiscourseUser | null;
  }
): Promise<RegistrationReserveResult> {
  const formId = options?.formId ?? "";
  const email = options?.user?.email?.trim() ?? "";
  const run = async (): Promise<RegistrationReserveResult> => {
    const payload = withDiscourseUser(
      {
        action: "reserve",
        sheetTab,
        formId,
        requiresPayment: Boolean(options?.requiresPayment),
        reserveFields: [],
      },
      options?.user
    );
    const discourseUser = getRegistrationDiscourseUser(options?.user);
    const signal = options?.signal;
    return callRegistrationsApiOnce<RegistrationReserveResult>(
      apiKey,
      payload,
      signal,
      discourseUser
    );
  };

  if (formId && email) {
    return withReserveDedupe(formId, email, run);
  }
  return run();
}
