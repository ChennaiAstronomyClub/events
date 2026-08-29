import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  userApiKeyFromHeaders,
  verifyDiscourseAdmin,
} from "../server/lib/discourse-admin.js";
import { isSheetsApiConfigured } from "../server/lib/sheets/client.js";
import { listAttendance } from "../server/lib/sheets/attendance.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";
import { sendCalendarInvites } from "../server/lib/calendar/send.js";
import { getCalendarEvent } from "../src/lib/calendar/event.js";
import { htmlHasText, sanitizeInviteSubject } from "../src/lib/calendar/email.js";
import { isCalendarEmailConfigured } from "../server/lib/calendar/config.js";

/**
 * POST /api/calendar-invites
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { formId: string, emails?: string[], subject?: string, body?: string }
 *
 * Discourse-admin-only. Sends ICS calendar invites to confirmed registrants.
 * Omit `emails` to send to everyone on the roster; otherwise intersect with it.
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
  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  if (!formId) {
    return res.status(400).json({ success: false, error: "Missing formId" });
  }

  if (!getCalendarEvent(formId)) {
    return res.status(400).json({
      success: false,
      error: "no_calendar_event",
      message: "This event has no start and end time configured for calendar invites.",
    });
  }

  if (!isCalendarEmailConfigured()) {
    return res.status(500).json({
      success: false,
      error: "not_configured",
      message: "Calendar invites are not configured. Set RESEND_API_KEY.",
    });
  }

  if (typeof body.subject === "string" && !sanitizeInviteSubject(body.subject)) {
    return res.status(400).json({
      success: false,
      error: "invalid_subject",
      message: "Email subject is required.",
    });
  }
  if (typeof body.body === "string" && !htmlHasText(body.body)) {
    return res.status(400).json({
      success: false,
      error: "invalid_body",
      message: "Email body is required.",
    });
  }

  try {
    const roster = await listAttendance(formId);
    if (!roster.success) {
      return res.status(400).json(roster);
    }

    const byEmail = new Map<string, { email: string; name: string }>();
    for (const record of roster.registrations) {
      const email = record.email.trim().toLowerCase();
      if (!email) continue;
      if (!byEmail.has(email)) {
        byEmail.set(email, { email: record.email.trim(), name: record.name });
      }
    }

    let selected: { email: string; name: string }[];
    if (!Object.prototype.hasOwnProperty.call(body, "emails")) {
      selected = [...byEmail.values()];
    } else if (!Array.isArray(body.emails)) {
      return res.status(400).json({
        success: false,
        error: "invalid_emails",
        message: "emails must be an array of strings.",
      });
    } else {
      const requested = new Set(
        body.emails
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      );
      selected = [];
      for (const key of requested) {
        const match = byEmail.get(key);
        if (match) selected.push(match);
      }
    }

    const result = await sendCalendarInvites(formId, selected, {
      subject: typeof body.subject === "string" ? body.subject : undefined,
      body: typeof body.body === "string" ? body.body : undefined,
    });
    return res.status(200).json({ success: true, formId, ...result });
  } catch (err) {
    const mapped = mapSheetsError(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
