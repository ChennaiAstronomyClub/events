import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

/**
 * POST /api/calendar-invites
 *
 * Temporarily disabled — redesign planned (not on Google Calendar yet).
 * Previous Resend/ICS implementation remains in server/lib/calendar/ for reuse.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  return res.status(503).json({
    success: false,
    error: "calendar_invites_disabled",
    message:
      "Calendar invites are temporarily disabled. This feature will return after a redesign.",
  });
}
