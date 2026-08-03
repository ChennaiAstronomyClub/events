import { useEffect, useState } from "react";
import { checkRegistrationWhitelist } from "@/lib/google-sheets";
import type { DiscourseUser } from "@/types/discourse";

type WhitelistCheckStatus = "idle" | "checking" | "allowed" | "denied" | "error";

/**
 * Asks the server whether an identity may bypass closed/full registration.
 * Supports logged-in users (apiKey) and guest invite links (email/phone query params).
 */
export function useRegistrationWhitelistCheck(options: {
  enabled: boolean;
  formId: string | undefined;
  apiKey?: string | null;
  user?: DiscourseUser | null;
  /** Invite or profile email used for matching */
  email?: string | null;
  phone?: string | null;
}): { status: WhitelistCheckStatus; allowed: boolean } {
  const { enabled, formId, apiKey, user, email, phone } = options;
  const [status, setStatus] = useState<WhitelistCheckStatus>("idle");

  useEffect(() => {
    const inviteEmail = email?.trim() || "";
    const invitePhone = phone?.trim() || "";
    const hasAuth = Boolean(apiKey && user?.email);
    const hasInvite = Boolean(inviteEmail || invitePhone);

    if (!enabled || !formId || (!hasAuth && !hasInvite)) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    checkRegistrationWhitelist(formId, {
      formId,
      apiKey: apiKey ?? undefined,
      user: user ?? undefined,
      email: inviteEmail || undefined,
      phone: invitePhone || undefined,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.allowed) {
          setStatus("allowed");
        } else if (result.success) {
          setStatus("denied");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, formId, apiKey, user?.email, email, phone]);

  return {
    status,
    allowed: status === "allowed",
  };
}
