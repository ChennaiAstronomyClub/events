import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  userApiKeyFromHeaders,
  verifyDiscourseAdmin,
} from "../server/lib/discourse-admin.js";
import { isSheetsApiConfigured } from "../server/lib/sheets/client.js";
import { listAttendance, updateAttendance } from "../server/lib/sheets/attendance.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";

/**
 * POST /api/attendance
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { action: "list" | "update", ... }
 *
 * Discourse-admin-only check-in roster and attendance updates.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const userApiKey = userApiKeyFromHeaders(req.headers);
  const adminCheck = await verifyDiscourseAdmin(userApiKey);
  if (!adminCheck.ok) {
    return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
  }

  if (!isSheetsApiConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Server configuration missing",
      message:
        "Configure Google Sheets API: GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY).",
    });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.trim() : "";

  try {
    if (action === "list") {
      const formId = typeof body.formId === "string" ? body.formId.trim() : "";
      if (!formId) {
        return res.status(400).json({ success: false, error: "Missing formId" });
      }
      const result = await listAttendance(formId);
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.status(200).json(result);
    }

    if (action === "update") {
      const formId = typeof body.formId === "string" ? body.formId.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const sheetRow = Number(body.sheetRow);
      if (!formId || !email || !sheetRow) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }

      const result = await updateAttendance({
        formId,
        sheetRow,
        email,
        registrantPresent: Boolean(body.registrantPresent),
        adultsPresent: Number(body.adultsPresent ?? 0),
        kidsPresent: Number(body.kidsPresent ?? 0),
      });

      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ success: false, error: "Invalid action" });
  } catch (err) {
    const mapped = mapSheetsError(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
