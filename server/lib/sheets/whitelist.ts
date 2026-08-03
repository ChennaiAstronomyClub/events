import type { RegistrationWhitelist } from "./config.js";

/** Normalize email for whitelist comparison. */
export function normalizeWhitelistEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Digits-only phone key. Prefer last 10 digits so +91 / 0-prefix variants match.
 */
export function normalizeWhitelistPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export interface WhitelistIdentity {
  email?: string | null;
  phone?: string | null;
}

/** True if email and/or phone matches the form whitelist (either is enough). */
export function matchesRegistrationWhitelist(
  whitelist: RegistrationWhitelist | undefined,
  identity: WhitelistIdentity
): boolean {
  if (!whitelist) return false;

  const emails = (whitelist.emails ?? [])
    .map(normalizeWhitelistEmail)
    .filter(Boolean);
  const phones = (whitelist.phones ?? [])
    .map(normalizeWhitelistPhone)
    .filter(Boolean);

  if (emails.length === 0 && phones.length === 0) return false;

  const email = identity.email ? normalizeWhitelistEmail(identity.email) : "";
  if (email && emails.includes(email)) return true;

  const phone = identity.phone ? normalizeWhitelistPhone(identity.phone) : "";
  if (phone && phones.includes(phone)) return true;

  return false;
}
