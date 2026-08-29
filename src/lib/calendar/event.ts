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
