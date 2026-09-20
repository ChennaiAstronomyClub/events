import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  userApiKeyFromHeaders,
  verifyDiscourseAdmin,
} from "../server/lib/discourse-admin.js";
import { isSheetsApiConfigured } from "../server/lib/sheets/client.js";
import { WHITELIST_REGISTRATION_FORM_IDS, expectedSheetTabForForm } from "../server/lib/sheets/config.js";
import {
  addRegistrationWhitelistEntry,
  listRegistrationWhitelist,
  removeRegistrationWhitelistEntry,
} from "../server/lib/sheets/registration-whitelist.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";
import { captureServerException } from "../server/lib/sentry.js";

/**
 * POST /api/registration-whitelist
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { action: "list" | "add" | "remove", formId, ... }
 *
 * Discourse-admin-only management of per-event registration whitelist identities.
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
  const formId = typeof body.formId === "string" ? body.formId.trim() : "";

  if (!formId || !expectedSheetTabForForm(formId)) {
    return res.status(400).json({
      success: false,
      error: "unknown_form_id",
      message: "Unknown form.",
    });
  }

  if (!WHITELIST_REGISTRATION_FORM_IDS.has(formId)) {
    return res.status(400).json({
      success: false,
      error: "whitelist_not_enabled",
      message: "This event does not allow registration whitelist bypass.",
    });
  }

  try {
    if (action === "list") {
      const entries = await listRegistrationWhitelist(formId);
      return res.status(200).json({ success: true, formId, entries });
    }

    if (action === "add") {
      const result = await addRegistrationWhitelistEntry({
        formId,
        email: typeof body.email === "string" ? body.email : undefined,
        phone: typeof body.phone === "string" ? body.phone : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        addedBy: adminCheck.username,
      });
      if (!result.success) {
        const status = result.error === "duplicate" ? 409 : 400;
        return res.status(status).json(result);
      }
      return res.status(200).json({ success: true, formId, entry: result.entry });
    }

    if (action === "remove") {
      const sheetRow = Number(body.sheetRow);
      const result = await removeRegistrationWhitelistEntry({ formId, sheetRow });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.status(200).json({ success: true, formId, sheetRow: result.sheetRow });
    }

    return res.status(400).json({ success: false, error: "Invalid action" });
  } catch (err) {
    const mapped = mapSheetsError(err);
    await captureServerException(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
