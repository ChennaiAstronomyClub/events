import { useEffect, useState } from "react";
import { checkRegistrationWhitelist } from "@/lib/google-sheets";
import type { DiscourseUser } from "@/types/discourse";

type WhitelistCheckStatus = "idle" | "checking" | "allowed" | "denied" | "error";

/**
 * Asks the server whether an identity may bypass closed/full registration.
 * Supports logged-in users (apiKey) and guest invite tokens (?invite=).
 * When allowed via invite, returns email/phone sealed to that token.
 */
export function useRegistrationWhitelistCheck(options: {
  enabled: boolean;
  formId: string | undefined;
  apiKey?: string | null;
  user?: DiscourseUser | null;
  /** Opaque invite token from the shareable link */
  invite?: string | null;
}): {
  status: WhitelistCheckStatus;
  allowed: boolean;
  email: string | null;
  phone: string | null;
} {
  const { enabled, formId, apiKey, user, invite } = options;
  const [status, setStatus] = useState<WhitelistCheckStatus>("idle");
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    const inviteToken = invite?.trim() || "";
    const hasAuth = Boolean(apiKey && user?.email);
    const hasInvite = Boolean(inviteToken);

    if (!enabled || !formId || (!hasAuth && !hasInvite)) {
      setStatus("idle");
      setEmail(null);
      setPhone(null);
      return;
    }

    let cancelled = false;
    setStatus("checking");

    checkRegistrationWhitelist(formId, {
      formId,
      apiKey: apiKey ?? undefined,
      user: user ?? undefined,
      invite: inviteToken || undefined,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.allowed) {
          setStatus("allowed");
          setEmail(typeof result.email === "string" ? result.email : null);
          setPhone(typeof result.phone === "string" ? result.phone : null);
        } else if (result.success) {
          setStatus("denied");
          setEmail(null);
          setPhone(null);
        } else {
          setStatus("error");
          setEmail(null);
          setPhone(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setEmail(null);
          setPhone(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, formId, apiKey, user?.email, invite]);

  return {
    status,
    allowed: status === "allowed",
    email,
    phone,
  };
}
