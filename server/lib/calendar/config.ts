const DEFAULT_FROM = "Chennai Astronomy Club <no-reply@chennaiastronomyclub.org>";
const DEFAULT_REPLY_TO = "hello@chennaiastronomyclub.org";

export function isCalendarEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getCalendarFromEmail(): string {
  return process.env.CALENDAR_FROM_EMAIL?.trim() || DEFAULT_FROM;
}

export function getCalendarReplyTo(): string {
  return process.env.CALENDAR_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
}

export function getResendApiKey(): string | undefined {
  const value = process.env.RESEND_API_KEY?.trim();
  return value || undefined;
}

export function parseFromAddress(from: string): { name: string; email: string } {
  const match = from.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: "Chennai Astronomy Club", email: from.trim() };
}
