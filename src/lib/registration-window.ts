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
