import {
  EVENT_CALENDAR_META,
  type EventCalendarMeta,
} from "../../config/event-calendar.js";
import { getFormRegistrationWindow } from "../../config/registration-windows.js";
import { formatIstDateTime, formatIstTime } from "../datetime.js";

export interface CalendarEvent {
  formId: string;
  title: string;
  startTime: string;
  endTime: string;
  venue?: string;
  url?: string;
}

export interface CalendarEventOverrides {
  title?: string;
  venue?: string;
  url?: string;
}

export const CALENDAR_TITLE_MAX = 200;
export const CALENDAR_VENUE_MAX = 300;
export const CALENDAR_URL_MAX = 500;

export function sanitizeCalendarTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, CALENDAR_TITLE_MAX);
  return trimmed || undefined;
}

/** Trim and cap an optional ICS override. Empty string means omit the property. */
export function sanitizeCalendarOverride(
  raw: unknown,
  max: number
): string | undefined {
  if (typeof raw !== "string") return undefined;
  return raw.trim().slice(0, max);
}

export function applyCalendarEventOverrides(
  event: CalendarEvent,
  overrides?: CalendarEventOverrides
): CalendarEvent {
  if (!overrides) return event;
  const next: CalendarEvent = { ...event };
  if (overrides.title?.trim()) {
    next.title = overrides.title.trim();
  }
  if (overrides.venue !== undefined) {
    const venue = overrides.venue.trim();
    if (venue) next.venue = venue;
    else delete next.venue;
  }
  if (overrides.url !== undefined) {
    const url = overrides.url.trim();
    if (url) next.url = url;
    else delete next.url;
  }
  return next;
}

export function getCalendarEvent(formId: string): CalendarEvent | null {
  const trimmed = formId.trim();
  const meta: EventCalendarMeta | undefined = EVENT_CALENDAR_META[trimmed];
  const window = getFormRegistrationWindow(trimmed);
  if (!meta || !window?.startTime || !window?.endTime) return null;
  return {
    formId: trimmed,
    title: meta.title,
    startTime: window.startTime,
    endTime: window.endTime,
    ...(meta.venue ? { venue: meta.venue } : {}),
    ...(meta.url ? { url: meta.url } : {}),
  };
}

export function formatCalendarWhen(event: CalendarEvent): string {
  const start = formatIstDateTime(event.startTime);
  const end = formatIstTime(event.endTime);
  return end ? `${start} – ${end}` : start;
}

export function calendarEventDescription(event: CalendarEvent): string {
  const lines = [
    "Chennai Astronomy Club event.",
    `When: ${formatCalendarWhen(event)}`,
  ];
  if (event.venue) lines.push(`Where: ${event.venue}`);
  if (event.url) lines.push(event.url);
  return lines.join("\n");
}
