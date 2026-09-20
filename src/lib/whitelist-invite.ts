/**
 * Invite query params for closed-registration whitelist links.
 * Example: /form/perseids-2026?email=person%40test.com
 *          /form/perseids-2026?phone=9xxxxxxxx
 *          /form/perseids-2026?email=person%40test.com&phone=9xxxxxxxx
 */
export const WHITELIST_INVITE_EMAIL_PARAM = "email";
export const WHITELIST_INVITE_PHONE_PARAM = "phone";

export interface WhitelistInviteIdentity {
  email: string | null;
  phone: string | null;
}

export function parseWhitelistInviteParams(
  searchParams: URLSearchParams
): WhitelistInviteIdentity {
  const email = searchParams.get(WHITELIST_INVITE_EMAIL_PARAM)?.trim() || null;
  const phone = searchParams.get(WHITELIST_INVITE_PHONE_PARAM)?.trim() || null;
  return { email, phone };
}

/** True when at least one invite identity param is present (even if email format is rough). */
export function hasWhitelistInviteParams(identity: WhitelistInviteIdentity): boolean {
  return Boolean(identity.email?.trim() || identity.phone?.trim());
}

/** Path for a shareable guest invite. Treat the URL as a secret. */
export function buildWhitelistInvitePath(
  formId: string,
  identity: { email?: string | null; phone?: string | null }
): string {
  const params = new URLSearchParams();
  const email = identity.email?.trim();
  const phone = identity.phone?.trim();
  if (email) params.set(WHITELIST_INVITE_EMAIL_PARAM, email);
  if (phone) params.set(WHITELIST_INVITE_PHONE_PARAM, phone);
  const qs = params.toString();
  return qs ? `/form/${encodeURIComponent(formId)}?${qs}` : `/form/${encodeURIComponent(formId)}`;
}
