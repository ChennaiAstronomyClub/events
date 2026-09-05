import {
  CALENDAR_INVITE_API_TIMEOUT_MS,
  CALENDAR_INVITE_CHUNK_SIZE,
} from "@/lib/api-timeouts";
import { storage } from "@/lib/storage";

export interface CalendarInviteSendResponse {
  success: boolean;
  formId?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
  errors?: { email: string; message: string }[];
  error?: string;
  message?: string;
}

export interface CalendarInviteProgress {
  processed: number;
  total: number;
}

function inviteHeaders(): HeadersInit | null {
  const apiKey = storage.getApiKey();
  if (!apiKey) return null;
  return {
    "Content-Type": "application/json",
    "User-Api-Key": apiKey,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function readJson(
  res: Response
): Promise<CalendarInviteSendResponse | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as CalendarInviteSendResponse;
  } catch {
    return null;
  }
}

function failureFromStatus(
  status: number,
  data: CalendarInviteSendResponse | null
): CalendarInviteSendResponse {
  if (data?.error || data?.message) {
    return {
      success: false,
      error: data.error ?? "send_failed",
      message: data.message ?? data.error,
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      success: false,
      error: "timeout",
      message:
        "The server timed out while sending invites. Try a smaller selection, then send the rest.",
    };
  }
  return {
    success: false,
    error: `http_${status}`,
    message: `Send failed (${status}).`,
  };
}

export interface CalendarInviteCopy {
  subject?: string;
  body?: string;
  title?: string;
  venue?: string;
  url?: string;
}

async function sendInviteChunk(
  formId: string,
  emails: string[] | undefined,
  copy?: CalendarInviteCopy
): Promise<CalendarInviteSendResponse> {
  const headers = inviteHeaders();
  if (!headers) {
    return {
      success: false,
      error: "unauthorized",
      message: "Not logged in. Log in as a Discourse admin and try again.",
    };
  }

  const payload: {
    formId: string;
    emails?: string[];
    subject?: string;
    body?: string;
    title?: string;
    venue?: string;
    url?: string;
  } = { formId };
  if (emails) payload.emails = emails;
  if (copy?.subject) payload.subject = copy.subject;
  if (copy?.body) payload.body = copy.body;
  if (copy?.title) payload.title = copy.title;
  if (copy?.venue !== undefined) payload.venue = copy.venue;
  if (copy?.url !== undefined) payload.url = copy.url;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CALENDAR_INVITE_API_TIMEOUT_MS
  );

  try {
    const res = await fetch("/api/calendar-invites", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await readJson(res);
    if (!res.ok) return failureFromStatus(res.status, data);
    if (!data) {
      return {
        success: false,
        error: "invalid_response",
        message: "The server returned an empty response while sending invites.",
      };
    }
    return data;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: "timeout",
        message:
          "Sending timed out. Try a smaller selection, then send the rest.",
      };
    }
    const message = err instanceof Error ? err.message : "Network error";
    return {
      success: false,
      error: "network",
      message:
        message === "Failed to fetch"
          ? "Could not reach the send API. If you are on localhost, run the API with npm run dev:full."
          : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendCalendarInvites(
  formId: string,
  emails?: string[],
  copy?: CalendarInviteCopy,
  onProgress?: (progress: CalendarInviteProgress) => void
): Promise<CalendarInviteSendResponse> {
  const targets = emails ?? [];
  const chunks =
    emails === undefined
      ? [undefined]
      : targets.length === 0
        ? [[]]
        : chunkArray(targets, CALENDAR_INVITE_CHUNK_SIZE);

  const totals: CalendarInviteSendResponse = {
    success: true,
    formId,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  let processed = 0;
  const total = emails === undefined ? 0 : targets.length;
  onProgress?.({ processed, total });

  for (const chunk of chunks) {
    const data = await sendInviteChunk(formId, chunk, copy);
    if (!data.success) {
      totals.success = false;
      totals.error = data.error;
      totals.message =
        (totals.sent ?? 0) > 0
          ? `Sent ${totals.sent} before failing: ${data.message ?? data.error}`
          : (data.message ?? data.error);
      return totals;
    }

    totals.sent = (totals.sent ?? 0) + (data.sent ?? 0);
    totals.failed = (totals.failed ?? 0) + (data.failed ?? 0);
    totals.skipped = (totals.skipped ?? 0) + (data.skipped ?? 0);
    if (data.errors?.length) {
      totals.errors = [...(totals.errors ?? []), ...data.errors];
    }
    processed += chunk?.length ?? data.sent ?? 0;
    onProgress?.({ processed: Math.min(processed, total || processed), total });
  }

  return totals;
}
