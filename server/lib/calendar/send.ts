import { Resend } from "resend";
import { getCalendarEvent } from "../../src/lib/calendar/event.js";
import { buildCalendarIcs } from "../../src/lib/calendar/ics.js";
import {
  defaultInviteBody,
  defaultInviteSubject,
  htmlToPlainText,
  inviteBodyToHtml,
  looksLikeHtml,
  sanitizeInviteBody,
  sanitizeInviteSubject,
} from "../../src/lib/calendar/email.js";
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

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [email],
    replyTo,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "invite.ics",
        content: Buffer.from(ics, "utf8"),
        contentType: "text/calendar; method=REQUEST",
      },
    ],
    headers: {
      "Content-Class": "urn:content-classes:calendarmessage",
    },
  });

  if (error) {
    console.error("[calendar] Resend send failed:", error.message);
    return { sent: false, error: error.message };
  }

  return { sent: true };
}

const SEND_GAP_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
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
    if (i < recipients.length - 1) await sleep(SEND_GAP_MS);
  }

  return result;
}
