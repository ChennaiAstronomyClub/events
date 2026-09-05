/**
 * IST wall-clock datetimes (naive ISO) for every form.
 * Single source of truth for client display and server enforcement.
 */
export interface FormRegistrationWindow {
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  startTime?: string;
  endTime?: string;
}

export const FORM_REGISTRATION_WINDOWS: Record<string, FormRegistrationWindow> = {
  "star-party-september-2026": {
    registrationOpensAt: "2026-09-05T21:00:00",
    registrationClosesAt: "2026-09-06T19:00:00",
    startTime: "2026-09-12T18:00:00",
    endTime: "2026-09-13T07:00:00",
  },
  "city-meetup-august-30": {
    registrationOpensAt: "2026-08-23T17:00:00",
    registrationClosesAt: "2026-08-23T19:00:00",
    startTime: "2026-08-30T15:30:00",
    endTime: "2026-08-30T18:00:00",
  },
  "city-meetup-august-2": {
    registrationClosesAt: "2026-08-02T18:00:00",
    startTime: "2026-08-02T15:30:00",
    endTime: "2026-08-02T18:00:00",
  },
  "perseids-2026": {
    registrationClosesAt: "2026-07-22T00:00:00",
    startTime: "2026-08-12T21:00:00",
    endTime: "2026-08-13T06:00:00",
  },
  "city-meetup-july-4": {
    registrationClosesAt: "2026-07-04T18:00:00",
    startTime: "2026-07-04T15:30:00",
    endTime: "2026-07-04T18:00:00",
  },
  "visual-astronomy-june-2026": {
    registrationClosesAt: "2026-06-07T23:00:00",
    startTime: "2026-06-13T11:00:00",
    endTime: "2026-06-14T07:00:00",
  },
  "city-meetup-may-31": {
    registrationOpensAt: "2026-05-29T08:30:00",
    registrationClosesAt: "2026-05-30T00:00:00",
    startTime: "2026-05-31T15:30:00",
    endTime: "2026-05-31T17:30:00",
  },
  "star-party-march-2026": {
    registrationClosesAt: "2026-03-08T00:00:00",
  },
  "star-party-april-2026": {
    registrationClosesAt: "2026-03-29T00:00:00",
  },
  "night-sky-passport-presale": {
    registrationClosesAt: "2026-05-27T00:00:00",
  },
  "visual-astronomy-june-2026-backfill": {
    registrationClosesAt: "2026-06-14T07:00:00",
  },
};

export function getFormRegistrationWindow(
  formId: string
): FormRegistrationWindow | undefined {
  return FORM_REGISTRATION_WINDOWS[formId.trim()];
}
