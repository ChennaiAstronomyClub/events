import { formatUtcCompact } from "../datetime.js";
import { calendarEventDescription, type CalendarEvent } from "./event.js";

/** Google Calendar "Add event" template URL. Does not require OAuth. */
export function googleCalendarTemplateUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatUtcCompact(event.startTime)}/${formatUtcCompact(event.endTime)}`,
    details: calendarEventDescription(event),
  });
  if (event.venue) params.set("location", event.venue);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
