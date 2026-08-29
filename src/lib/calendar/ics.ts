import { formatUtcCompact } from "../datetime.js";
import {
  calendarEventDescription,
  type CalendarEvent,
} from "./event.js";

export type CalendarIcsMethod = "REQUEST" | "PUBLISH";

export interface BuildCalendarIcsOptions {
  event: CalendarEvent;
  method: CalendarIcsMethod;
  attendeeEmail?: string;
  attendeeName?: string;
  organizerEmail?: string;
  organizerName?: string;
}

const UID_HOST = "events.chennaiastronomyclub.org";
const ICS_CRLF = "\r\n";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcNowCompact(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  const max = 75;
  if (line.length <= max) return line;
  const parts: string[] = [line.slice(0, max)];
  let remaining = line.slice(max);
  while (remaining.length > 0) {
    parts.push(` ${remaining.slice(0, max - 1)}`);
    remaining = remaining.slice(max - 1);
  }
  return parts.join(ICS_CRLF);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function calendarEventUid(formId: string, attendeeEmail?: string): string {
  const id = formId.trim().toLowerCase();
  if (attendeeEmail?.trim()) {
    return `${id}-${normalizeEmail(attendeeEmail)}@${UID_HOST}`;
  }
  return `${id}@${UID_HOST}`;
}

export function buildCalendarIcs(options: BuildCalendarIcsOptions): string {
  const {
    event,
    method,
    attendeeEmail,
    attendeeName,
    organizerEmail,
    organizerName,
  } = options;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chennai Astronomy Club//Events//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${calendarEventUid(event.formId, attendeeEmail)}`,
    `DTSTAMP:${formatUtcNowCompact()}`,
    `DTSTART:${formatUtcCompact(event.startTime)}`,
    `DTEND:${formatUtcCompact(event.endTime)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(calendarEventDescription(event))}`,
  ];

  if (event.venue) {
    lines.push(`LOCATION:${escapeIcsText(event.venue)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  if (organizerEmail) {
    const cn = organizerName ? `;CN=${escapeIcsText(organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${organizerEmail.trim()}`);
  }
  if (method === "REQUEST" && attendeeEmail) {
    const cn = attendeeName?.trim()
      ? `;CN=${escapeIcsText(attendeeName.trim())}`
      : "";
    lines.push(
      `ATTENDEE${cn};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${normalizeEmail(attendeeEmail)}`
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldIcsLine).join(ICS_CRLF) + ICS_CRLF;
}
