import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /api/notice?formId=<id>
 * Headers: User-Api-Key: <discourse user api key>
 *
 * Fetches the user's Discourse profile, filters the notice list for the given
 * form down to notices the user qualifies for, strips targeting metadata, and
 * returns the result. Notice content lives entirely in Vercel environment
 * variables — nothing sensitive is ever in the client JS bundle.
 *
 * Env var format (one per form, e.g. NOTICE_STAR_PARTY_MARCH_2026):
 *   JSON array of NoticeConfig objects (see schema below).
 */

interface NoticeConfig {
  id: string;
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  type?: "info" | "warning" | "success";
  dismissible?: boolean;
  // Targeting (server-side only — stripped from response)
  groups?: string[];
  usernames?: string[];
  minTrustLevel?: number;
  activeFrom?: string;
  activeUntil?: string;
}

interface NoticeResponse {
  id: string;
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  type?: "info" | "warning" | "success";
  dismissible?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const formId = req.query.formId as string | undefined;
  if (!formId) return res.status(400).json({ error: "Missing formId" });

  // Look up notice array from env var (e.g. NOTICE_STAR_PARTY_MARCH_2026)
  const envKey = `NOTICE_${formId.toUpperCase().replace(/-/g, "_")}`;
  const noticeJson = process.env[envKey];
  if (!noticeJson) return res.status(200).json([]);

  let notices: NoticeConfig[];
  try {
    notices = JSON.parse(noticeJson);
    if (!Array.isArray(notices)) return res.status(200).json([]);
  } catch {
    return res.status(500).json({ error: "Invalid notice configuration" });
  }

  // Require Discourse user API key
  const apiKey = req.headers["user-api-key"] as string | undefined;
  if (!apiKey) return res.status(401).json({ error: "Unauthorized" });

  // Fetch user data from Discourse to evaluate targeting conditions
  const discourseUrl = (process.env.VITE_DISCOURSE_URL ?? "").replace(/\/+$/, "");
  let currentUser: { username: string; trust_level: number; groups: { name: string }[] };
  try {
    const dr = await fetch(`${discourseUrl}/session/current.json`, {
      headers: { "User-Api-Key": apiKey },
    });
    if (!dr.ok) return res.status(403).json({ error: "Forbidden" });
    const data = await dr.json();
    currentUser = data.current_user;
    if (!currentUser) return res.status(403).json({ error: "Forbidden" });
  } catch {
    return res.status(500).json({ error: "Failed to verify access" });
  }

  const userGroupNames = (currentUser.groups ?? []).map((g) => g.name);
  const now = new Date();

  // Filter notices to those this user qualifies for
  const visible: NoticeResponse[] = notices
    .filter((notice) => {
      // Time window check (server-side — not manipulable by client)
      if (notice.activeFrom && new Date(notice.activeFrom) > now) return false;
      if (notice.activeUntil && new Date(notice.activeUntil) < now) return false;

      // Trust level check
      if (
        notice.minTrustLevel !== undefined &&
        currentUser.trust_level < notice.minTrustLevel
      )
        return false;

      // Group / username targeting: if either is set, user must match at least one
      const hasGroupTarget = notice.groups && notice.groups.length > 0;
      const hasUsernameTarget = notice.usernames && notice.usernames.length > 0;
      if (hasGroupTarget || hasUsernameTarget) {
        const inGroup = hasGroupTarget && notice.groups!.some((g) => userGroupNames.includes(g));
        const isUser = hasUsernameTarget && notice.usernames!.includes(currentUser.username);
        if (!inGroup && !isUser) return false;
      }

      return true;
    })
    .map(
      // Strip targeting metadata before returning to client
      ({ id, title, message, linkUrl, linkLabel, type, dismissible }) => ({
        id,
        title,
        message,
        linkUrl,
        linkLabel,
        type,
        dismissible,
      })
    );

  return res.status(200).json(visible);
}
