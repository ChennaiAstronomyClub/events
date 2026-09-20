/**
 * Allowlisted sheet column keys writable from client submit/update payloads.
 * Keep in sync with FormConfig.fields[].name in src/config/forms.ts.
 * Unknown client keys are dropped — never create sheet headers from them.
 */
export const FORM_FIELD_WRITE_KEYS = new Set([
  "name",
  "email",
  "phone",
  "bringingParticipants",
  "adultParticipants",
  "kidParticipants",
  "adultCopies",
  "kidsCopies",
  "upiReferenceLast4",
  "age",
  "equipment",
  "canBringCar",
  "carSeats",
  "location",
  "emergencyContact",
  "bloodGroup",
  "observationalSkills",
  "eventReason",
  "additionalQuestions",
  "conductCode",
  "riskDisclaimer",
  "nights",
]);

/**
 * Keys `buildSubmitBody` may place on the submit payload (not free-form client columns).
 * Sheet-owned columns (Status, PaymentStatus, SeatStatus, …) must NOT be listed here —
 * the server writes those via dedicated extras after the allowlist copy.
 */
export const SERVER_SUBMIT_KEYS = new Set([
  "Timestamp",
  "username",
  "memberType",
  "email",
  "formId",
  "requiresPayment",
]);

export function isAllowedSubmitKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (SERVER_SUBMIT_KEYS.has(trimmed)) return true;
  if (FORM_FIELD_WRITE_KEYS.has(trimmed)) return true;
  return false;
}

export function isAllowedUpdateKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  // Updates must be form fields only — never server/payment/attendance columns.
  return FORM_FIELD_WRITE_KEYS.has(trimmed);
}
