import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  userApiKeyFromHeaders,
  verifyDiscourseAdmin,
} from "../server/lib/discourse-admin.js";
import { isSheetsApiConfigured } from "../server/lib/sheets/client.js";
import { listAttendance, syncAttendance, updateAttendance } from "../server/lib/sheets/attendance.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";
import { captureServerException } from "../server/lib/sentry.js";

/**
 * POST /api/attendance
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { action: "list" | "update" | "sync", ... }
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
        "Registration is temporarily unavailable. Please try again in a few minutes.",
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

    if (action === "sync") {
      const formId = typeof body.formId === "string" ? body.formId.trim() : "";
      if (!formId) {
        return res.status(400).json({ success: false, error: "Missing formId" });
      }
      const sinceVersion = Number(body.sinceVersion ?? 0);
      const result = await syncAttendance(
        formId,
        Number.isFinite(sinceVersion) ? sinceVersion : 0
      );
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
    await captureServerException(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
