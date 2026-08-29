import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  userApiKeyFromHeaders,
  verifyDiscourseAdmin,
} from "../server/lib/discourse-admin.js";

/**
 * POST /api/send-notice
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { formId: string }
 *
 * Discourse-admin-only. Email notifications are disabled for now; this
 * endpoint is a no-op so the route stays stable when bulk email is
 * re-enabled later. Auth is still required so the route cannot be probed
 * or invoked by non-admins.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const adminCheck = await verifyDiscourseAdmin(userApiKeyFromHeaders(req.headers));
  if (!adminCheck.ok) {
    return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
  }

  return res.status(200).json({
    sent: 0,
    failed: 0,
    disabled: true,
    message: "Email notifications are not enabled",
  });
}
