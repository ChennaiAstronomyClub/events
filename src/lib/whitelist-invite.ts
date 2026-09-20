/**
 * Opaque invite query param for closed-registration whitelist links.
 * Example: /form/perseids-2026?invite=<random-per-entry-token>
 *
 * Each whitelist entry gets its own random token (stored on the sheet / Redis).
 * Treat the URL as a secret. Identity (email/phone) comes from the server after
 * whitelistCheck — the token itself is opaque.
 */
export const WHITELIST_INVITE_TOKEN_PARAM = "invite";

export interface WhitelistInviteIdentity {
  /** Opaque invite token from the shareable link. */
  invite: string | null;
}

export function parseWhitelistInviteParams(
  searchParams: URLSearchParams
): WhitelistInviteIdentity {
  const invite = searchParams.get(WHITELIST_INVITE_TOKEN_PARAM)?.trim() || null;
  return { invite };
}

/** True when an invite token param is present (validity is checked on the server). */
export function hasWhitelistInviteParams(identity: WhitelistInviteIdentity): boolean {
  return Boolean(identity.invite?.trim());
}

/** Path for a shareable guest invite. Treat the URL as a secret. */
export function buildWhitelistInvitePath(formId: string, inviteToken: string): string {
  const params = new URLSearchParams();
  const token = inviteToken.trim();
  if (token) params.set(WHITELIST_INVITE_TOKEN_PARAM, token);
  const qs = params.toString();
  return qs
    ? `/form/${encodeURIComponent(formId)}?${qs}`
    : `/form/${encodeURIComponent(formId)}`;
}
