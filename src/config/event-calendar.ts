import { getFormRegistrationWindow } from "./registration-windows.js";

/**
 * Calendar-invite metadata. Kept Node-safe (no import.meta / Discourse env)
 * so API routes can load it without pulling in the full form catalog.
 */
export interface EventCalendarMeta {
  /** Calendar SUMMARY; talk title is included when the event has one. */
  title: string;
  venue?: string;
  url?: string;
}

export const EVENT_CALENDAR_META: Record<string, EventCalendarMeta> = {
  "star-party-september-2026": {
    title: "Star Party - September 2026",
  },
  "city-meetup-august-30": {
    title: "City Meetup Series: A Brief History of the Universe",
  },
  "city-meetup-august-2": {
    title: "City Meetup Series: Listening to the First Billion Years of the Universe",
  },
  "perseids-2026": {
    title: "Perseids Meteor Shower - 2026",
  },
  "city-meetup-july-4": {
    title: "City Meetup Series: The Multilingual Universe",
  },
  "visual-astronomy-june-2026": {
    title: "First Light: Beginners' Visual Astronomy Workshop",
    url: "https://forum.chennaiastronomyclub.org/t/first-light-beginners-workshop-on-visual-astronomy/",
  },
  "city-meetup-may-31": {
    title: "City Meetup Series: Studying Undead Stars to Understand Theories of Physics",
  },
};

export function getEventCalendarMeta(formId: string): EventCalendarMeta | undefined {
  return EVENT_CALENDAR_META[formId.trim()];
}

/** True when the form has both a calendar title and start/end times. */
export function hasCalendarTimes(formId: string): boolean {
  const window = getFormRegistrationWindow(formId.trim());
  return Boolean(
    getEventCalendarMeta(formId) && window?.startTime && window?.endTime
  );
}
