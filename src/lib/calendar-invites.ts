import { storage } from "@/lib/storage";

export interface CalendarInviteSendResponse {
  success: boolean;
  formId?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
  errors?: { email: string; message: string }[];
  error?: string;
  message?: string;
}

function inviteHeaders(): HeadersInit {
  const apiKey = storage.getApiKey();
  if (!apiKey) throw new Error("Not logged in");
  return {
    "Content-Type": "application/json",
    "User-Api-Key": apiKey,
  };
}

export async function sendCalendarInvites(
  formId: string,
  emails?: string[],
  copy?: { subject?: string; body?: string }
): Promise<CalendarInviteSendResponse> {
  const payload: {
    formId: string;
    emails?: string[];
    subject?: string;
    body?: string;
  } = { formId };
  if (emails) payload.emails = emails;
  if (copy?.subject) payload.subject = copy.subject;
  if (copy?.body) payload.body = copy.body;
  const res = await fetch("/api/calendar-invites", {
    method: "POST",
    headers: inviteHeaders(),
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<CalendarInviteSendResponse>;
}
