import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/send-notice
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { formId: string }
 *
 * Email notifications are disabled for now. This endpoint is a no-op so the
 * route stays stable when bulk email is re-enabled later.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  return res.status(200).json({
    sent: 0,
    failed: 0,
    disabled: true,
    message: "Email notifications are not enabled",
  });
}
