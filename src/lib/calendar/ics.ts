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
const ICS_FOLD_OCTETS = 75;
const utf8Encoder = new TextEncoder();

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

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Quote ICS parameter values that contain space, colon, semicolon, or comma. */
function escapeIcsParam(value: string): string {
  const cleaned = value.replace(/"/g, "");
  if (/[\s;:,]/.test(cleaned)) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

function foldIcsLine(line: string): string {
  if (utf8ByteLength(line) <= ICS_FOLD_OCTETS) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let first = true;

  for (const char of line) {
    const charBytes = utf8ByteLength(char);
    const limit = first ? ICS_FOLD_OCTETS : ICS_FOLD_OCTETS - 1;
    if (current.length > 0 && currentBytes + charBytes > limit) {
      parts.push(first ? current : ` ${current}`);
      first = false;
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) {
    parts.push(first ? current : ` ${current}`);
  }
  return parts.join(ICS_CRLF);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function uidLocalPart(email: string): string {
  return normalizeEmail(email).replace(/@/g, ".at.");
}

export function calendarEventUid(formId: string, attendeeEmail?: string): string {
  const id = formId.trim().toLowerCase();
  if (attendeeEmail?.trim()) {
    return `${id}-${uidLocalPart(attendeeEmail)}@${UID_HOST}`;
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
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
  ];

  if (event.venue) {
    lines.push(`LOCATION:${escapeIcsText(event.venue)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  if (organizerEmail) {
    const cn = organizerName?.trim()
      ? `;CN=${escapeIcsParam(organizerName.trim())}`
      : "";
    lines.push(`ORGANIZER${cn}:mailto:${organizerEmail.trim()}`);
  }
  if (method === "REQUEST" && attendeeEmail) {
    const cn = attendeeName?.trim()
      ? `;CN=${escapeIcsParam(attendeeName.trim())}`
      : "";
    lines.push(
      `ATTENDEE${cn};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${normalizeEmail(attendeeEmail)}`
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldIcsLine).join(ICS_CRLF) + ICS_CRLF;
}
