import { formatCalendarWhen, type CalendarEvent } from "./event.js";

export const INVITE_SUBJECT_MAX = 200;
export const INVITE_BODY_MAX = 20000;

export function defaultInviteSubject(event: CalendarEvent): string {
  return `Calendar invite: ${event.title}`;
}

export function defaultInviteBody(event: CalendarEvent): string {
  const lines = [`You're registered for ${event.title}.`, "", `When: ${formatCalendarWhen(event)}`];
  if (event.venue) lines.push(`Where: ${event.venue}`);
  if (event.url) {
    lines.push("");
    lines.push(`Event details: ${event.url}`);
  }
  lines.push("");
  lines.push(
    "This email includes a calendar invite. Open it to add the event to Google Calendar, Outlook, or Apple Calendar."
  );
  lines.push("");
  lines.push("— Chennai Astronomy Club");
  return lines.join("\n");
}

export function defaultInviteHtml(event: CalendarEvent): string {
  const parts = [
    `<p>You're registered for <strong>${escapeHtml(event.title)}</strong>.</p>`,
    `<p><strong>When:</strong> ${escapeHtml(formatCalendarWhen(event))}</p>`,
  ];
  if (event.venue) {
    parts.push(`<p><strong>Where:</strong> ${escapeHtml(event.venue)}</p>`);
  }
  if (event.url) {
    parts.push(`<p><a href="${escapeHtml(event.url)}">Event details</a></p>`);
  }
  parts.push(
    "<p>This email includes a calendar invite. Open it to add the event to Google Calendar, Outlook, or Apple Calendar.</p>"
  );
  parts.push("<p>— Chennai Astronomy Club</p>");
  return parts.join("\n");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert plain-text email body to simple HTML paragraphs. */
export function inviteBodyToHtml(body: string): string {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlHasText(html: string): boolean {
  return htmlToPlainText(html).length > 0;
}

export function sanitizeInviteSubject(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, INVITE_SUBJECT_MAX);
  return trimmed || undefined;
}

export function sanitizeInviteBody(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, INVITE_BODY_MAX);
  if (!trimmed) return undefined;
  if (looksLikeHtml(trimmed) && !htmlHasText(trimmed)) return undefined;
  return trimmed;
}
