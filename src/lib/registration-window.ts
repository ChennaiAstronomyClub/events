import { parseIstDateTime } from "./datetime.js";
import type { FormRegistrationWindow } from "../config/registration-windows.js";

export type RegistrationStatus = "not-yet-open" | "open" | "closed";

/**
 * Compute whether registration is currently open, not yet open, or closed
 * based on IST wall-clock timestamps. If neither open/close is set, always open.
 */
export function getRegistrationStatus(
  window: FormRegistrationWindow | undefined
): RegistrationStatus {
  const now = new Date();
  if (window?.registrationOpensAt && parseIstDateTime(window.registrationOpensAt) > now) {
    return "not-yet-open";
  }
  if (window?.registrationClosesAt && parseIstDateTime(window.registrationClosesAt) < now) {
    return "closed";
  }
  return "open";
}

/** True once the event's endTime has passed. Forms without endTime are never over. */
export function isEventOver(window: FormRegistrationWindow | undefined): boolean {
  if (!window?.endTime) return false;
  return parseIstDateTime(window.endTime) < new Date();
}

export type HomeListingSection = "open" | "upcoming" | "past";

/**
 * Past for the public listing: ended events, started events with no endTime,
 * or closed forms with no remaining start/end date (legacy listings).
 */
export function isListedEventPast(
  window: FormRegistrationWindow | undefined
): boolean {
  if (isEventOver(window)) return true;
  if (!window) return false;
  const now = new Date();
  if (!window.endTime && window.startTime && parseIstDateTime(window.startTime) < now) {
    return true;
  }
  if (
    !window.startTime &&
    !window.endTime &&
    getRegistrationStatus(window) === "closed"
  ) {
    return true;
  }
  return false;
}

export function getHomeListingSection(
  window: FormRegistrationWindow | undefined
): HomeListingSection {
  if (isListedEventPast(window)) return "past";
  if (getRegistrationStatus(window) === "open") return "open";
  return "upcoming";
}

function listingStartMs(window: FormRegistrationWindow): number {
  return window.startTime
    ? parseIstDateTime(window.startTime).getTime()
    : Number.POSITIVE_INFINITY;
}

function listingRecencyMs(window: FormRegistrationWindow): number {
  const iso = window.endTime ?? window.startTime;
  return iso ? parseIstDateTime(iso).getTime() : Number.NEGATIVE_INFINITY;
}

/** Group listed forms into Open / Upcoming / Past with section-specific sort. */
export function groupFormsForHomeListing<T extends FormRegistrationWindow>(
  forms: T[]
): Record<HomeListingSection, T[]> {
  const grouped: Record<HomeListingSection, T[]> = {
    open: [],
    upcoming: [],
    past: [],
  };
  for (const form of forms) {
    grouped[getHomeListingSection(form)].push(form);
  }
  grouped.open.sort((a, b) => listingStartMs(a) - listingStartMs(b));
  grouped.upcoming.sort((a, b) => listingStartMs(a) - listingStartMs(b));
  grouped.past.sort((a, b) => listingRecencyMs(b) - listingRecencyMs(a));
  return grouped;
}

/**
 * Gate for new registrations (reserve/submit).
 * Whitelist may bypass closed / not-yet-open, but never an ended event.
 */
export function getNewRegistrationDenial(
  window: FormRegistrationWindow | undefined,
  whitelistBypass: boolean
): { error: string; message: string } | null {
  if (isEventOver(window)) {
    return { error: "event_over", message: "This event has ended." };
  }
  const status = getRegistrationStatus(window);
  if (status === "open" || whitelistBypass) return null;
  if (status === "not-yet-open") {
    return {
      error: "registration_not_open",
      message: "Registration is not yet open.",
    };
  }
  return {
    error: "registration_closed",
    message: "Registration for this event has closed.",
  };
}
