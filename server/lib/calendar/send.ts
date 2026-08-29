import { getCalendarEvent } from "../../../src/lib/calendar/event.js";
import { buildCalendarIcs } from "../../../src/lib/calendar/ics.js";
import {
  defaultInviteBody,
  defaultInviteSubject,
  htmlToPlainText,
  inviteBodyToHtml,
  looksLikeHtml,
  sanitizeInviteBody,
  sanitizeInviteSubject,
} from "../../../src/lib/calendar/email.js";
import { sanitizeInviteHtml } from "./sanitize.js";
import {
  getCalendarFromEmail,
  getCalendarReplyTo,
  getResendApiKey,
  isCalendarEmailConfigured,
  parseFromAddress,
} from "./config.js";

export interface SendCalendarInviteInput {
  formId: string;
  attendeeEmail: string;
  attendeeName?: string;
  subject?: string;
  body?: string;
}

export type SendCalendarInviteResult =
  | { sent: true }
  | { sent: false; skipped: string }
  | { sent: false; error: string };

export interface InviteCopy {
  subject?: string;
  body?: string;
}

const SEND_CONCURRENCY = 8;
const RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  async function run(): Promise<void> {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => run()));
}

async function sendResendEmail(options: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  ics: string;
}): Promise<{ name?: string; message: string } | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.to],
      reply_to: options.replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: [
        {
          filename: "invite.ics",
          content: Buffer.from(options.ics, "utf8").toString("base64"),
          content_type: "text/calendar; charset=UTF-8; method=REQUEST",
        },
      ],
      headers: {
        "Content-Class": "urn:content-classes:calendarmessage",
      },
    }),
  });

  if (res.ok) return null;

  let message = `Resend HTTP ${res.status}`;
  let name: string | undefined;
  try {
    const body = (await res.json()) as { message?: string; name?: string };
    if (body.message?.trim()) message = body.message.trim();
    if (body.name?.trim()) name = body.name.trim();
  } catch {
    // Keep the status fallback when Resend returns a non-JSON error page.
  }
  return { name, message };
}

export async function sendCalendarInviteIfConfigured(
  input: SendCalendarInviteInput
): Promise<SendCalendarInviteResult> {
  const email = input.attendeeEmail.trim();
  if (!email) {
    return { sent: false, skipped: "missing_email" };
  }

  const event = getCalendarEvent(input.formId);
  if (!event) {
    return { sent: false, skipped: "no_calendar_event" };
  }

  if (!isCalendarEmailConfigured()) {
    console.warn("[calendar] RESEND_API_KEY is not set; skipping invite");
    return { sent: false, skipped: "not_configured" };
  }

  const subject =
    sanitizeInviteSubject(input.subject) ?? defaultInviteSubject(event);
  const rawBody = sanitizeInviteBody(input.body);
  const text = rawBody
    ? looksLikeHtml(rawBody)
      ? htmlToPlainText(rawBody)
      : rawBody
    : defaultInviteBody(event);
  const html = rawBody
    ? looksLikeHtml(rawBody)
      ? sanitizeInviteHtml(rawBody)
      : inviteBodyToHtml(rawBody)
    : inviteBodyToHtml(defaultInviteBody(event));

  const apiKey = getResendApiKey()!;
  const from = getCalendarFromEmail();
  const replyTo = getCalendarReplyTo();
  const organizer = parseFromAddress(from);
  const ics = buildCalendarIcs({
    event,
    method: "REQUEST",
    attendeeEmail: email,
    attendeeName: input.attendeeName,
    organizerEmail: organizer.email,
    organizerName: organizer.name,
  });

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const error = await sendResendEmail({
      apiKey,
      from,
      to: email,
      replyTo,
      subject,
      html,
      text,
      ics,
    });

    if (!error) return { sent: true };

    const rateLimited = error.name === "rate_limit_exceeded" || error.message.toLowerCase().includes("rate limit");
    if (rateLimited && attempt < RATE_LIMIT_RETRIES) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    console.error("[calendar] Resend send failed:", error.message);
    return { sent: false, error: error.message };
  }

  return { sent: false, error: "Send failed" };
}

export interface BulkInviteRecipient {
  email: string;
  name?: string;
}

export interface BulkInviteResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: { email: string; message: string }[];
}

export async function sendCalendarInvites(
  formId: string,
  recipients: BulkInviteRecipient[],
  copy?: InviteCopy
): Promise<BulkInviteResult> {
  const result: BulkInviteResult = { sent: 0, failed: 0, skipped: 0, errors: [] };

  await runPool(recipients, SEND_CONCURRENCY, async (recipient) => {
    try {
      const outcome = await sendCalendarInviteIfConfigured({
        formId,
        attendeeEmail: recipient.email,
        attendeeName: recipient.name,
        subject: copy?.subject,
        body: copy?.body,
      });
      if (outcome.sent) {
        result.sent += 1;
      } else if ("skipped" in outcome) {
        result.skipped += 1;
      } else {
        result.failed += 1;
        result.errors.push({ email: recipient.email, message: outcome.error });
      }
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : "Send failed";
      result.errors.push({ email: recipient.email, message });
      console.error("[calendar] invite threw:", message);
    }
  });

  return result;
}
