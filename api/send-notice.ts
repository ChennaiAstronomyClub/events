import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/send-notice
 * Headers: User-Api-Key: <discourse user api key>
 * Body: { formId: string }
 *
 * Sends email notifications for a form's notices to all targeted Discourse
 * group members. Only Discourse admins can call this endpoint — verified
 * server-side using the caller's User API Key.
 *
 * Required environment variables (server-only, no VITE_ prefix):
 *   RESEND_API_KEY            — from resend.com
 *   DISCOURSE_ADMIN_API_KEY   — Discourse Admin → API → Global Key
 *   DISCOURSE_ADMIN_USERNAME  — Discourse admin username
 *   RESEND_FROM_EMAIL         — e.g. "CAC Events <noreply@chennaiastronomyclub.org>"
 */

interface NoticeConfig {
  id: string;
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  groups?: string[];
  usernames?: string[];
  activeFrom?: string;
  activeUntil?: string;
}

interface GroupMember {
  username: string;
  name: string;
  email: string;
}

const DISCOURSE_URL = (process.env.VITE_DISCOURSE_URL ?? "").replace(/\/+$/, "");
const ADMIN_API_KEY = process.env.DISCOURSE_ADMIN_API_KEY ?? "";
const ADMIN_USERNAME = process.env.DISCOURSE_ADMIN_USERNAME ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "CAC Events <noreply@example.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // Verify caller is a Discourse admin using their User API Key
  const userApiKey = req.headers["user-api-key"] as string | undefined;
  if (!userApiKey) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sessionRes = await fetch(`${DISCOURSE_URL}/session/current.json`, {
      headers: { "User-Api-Key": userApiKey },
    });
    if (!sessionRes.ok) return res.status(403).json({ error: "Forbidden" });
    const sessionData = await sessionRes.json();
    if (!sessionData.current_user?.admin) {
      return res.status(403).json({ error: "Requires Discourse admin" });
    }
  } catch {
    return res.status(500).json({ error: "Failed to verify admin status" });
  }

  const { formId } = req.body as { formId?: string };
  if (!formId) return res.status(400).json({ error: "Missing formId" });

  // Load notice config for this form
  const envKey = `NOTICE_${formId.toUpperCase().replace(/-/g, "_")}`;
  const noticeJson = process.env[envKey];
  if (!noticeJson) return res.status(404).json({ error: "No notices configured for this form" });

  let notices: NoticeConfig[];
  try {
    notices = JSON.parse(noticeJson);
    if (!Array.isArray(notices)) throw new Error("Not an array");
  } catch {
    return res.status(500).json({ error: "Invalid notice configuration" });
  }

  // Filter to currently active notices only
  const now = new Date();
  const active = notices.filter((n) => {
    if (n.activeFrom && new Date(n.activeFrom) > now) return false;
    if (n.activeUntil && new Date(n.activeUntil) < now) return false;
    return true;
  });

  if (!active.length) {
    return res.status(200).json({ sent: 0, message: "No active notices to send" });
  }

  // Collect all targeted email addresses from Discourse
  const emailSet = new Set<string>();
  const recipientMap = new Map<string, GroupMember>();

  for (const notice of active) {
    // Fetch members of each targeted group
    for (const groupName of notice.groups ?? []) {
      try {
        const members = await fetchGroupMembers(groupName);
        for (const m of members) {
          if (m.email && !emailSet.has(m.email)) {
            emailSet.add(m.email);
            recipientMap.set(m.email, m);
          }
        }
      } catch (err) {
        console.error(`Failed to fetch members for group ${groupName}:`, err);
      }
    }

    // Fetch specific targeted usernames
    for (const username of notice.usernames ?? []) {
      try {
        const member = await fetchUserByUsername(username);
        if (member?.email && !emailSet.has(member.email)) {
          emailSet.add(member.email);
          recipientMap.set(member.email, member);
        }
      } catch (err) {
        console.error(`Failed to fetch user ${username}:`, err);
      }
    }
  }

  const recipients = Array.from(recipientMap.values());
  if (!recipients.length) {
    return res.status(200).json({ sent: 0, message: "No recipients found" });
  }

  // Build email subject and HTML from the first active notice
  // (multiple notices in one email would require a more complex template)
  const primaryNotice = active[0];
  const subject = primaryNotice.title ?? `Update: ${formId}`;
  const html = buildEmailHtml(active);

  // Send via Resend batch API (max 100 per batch)
  let sent = 0;
  let failed = 0;

  const batches = chunk(recipients, 100);
  for (const batch of batches) {
    const emails = batch.map((r) => ({
      from: FROM_EMAIL,
      to: [r.email],
      subject,
      html: html.replace("{{name}}", escapeHtml(r.name || r.username)),
    }));

    try {
      const resendRes = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emails),
      });

      if (resendRes.ok) {
        sent += batch.length;
      } else {
        const err = await resendRes.json();
        console.error("Resend batch error:", err);
        failed += batch.length;
      }
    } catch (err) {
      console.error("Resend request failed:", err);
      failed += batch.length;
    }
  }

  return res.status(200).json({ sent, failed });
}

/** Fetch all members (paginated) of a Discourse group using admin credentials. */
async function fetchGroupMembers(groupName: string): Promise<GroupMember[]> {
  const members: GroupMember[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url = `${DISCOURSE_URL}/groups/${encodeURIComponent(groupName)}/members.json?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        "Api-Key": ADMIN_API_KEY,
        "Api-Username": ADMIN_USERNAME,
      },
    });
    if (!res.ok) break;

    const data = await res.json();
    const page: GroupMember[] = data.members ?? [];
    members.push(...page);

    if (page.length < limit) break;
    offset += limit;
  }

  return members;
}

/** Fetch a single user's email using the admin API. */
async function fetchUserByUsername(username: string): Promise<GroupMember | null> {
  const res = await fetch(
    `${DISCOURSE_URL}/admin/users/${encodeURIComponent(username)}.json`,
    {
      headers: {
        "Api-Key": ADMIN_API_KEY,
        "Api-Username": ADMIN_USERNAME,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return { username: data.username, name: data.name ?? data.username, email: data.email };
}

/** Build HTML email body from the list of active notices. */
function buildEmailHtml(notices: NoticeConfig[]): string {
  const items = notices
    .map((n) => {
      const linkHtml = n.linkUrl
        ? `<p><a href="${n.linkUrl}">${n.linkLabel ?? n.linkUrl}</a></p>`
        : "";
      return `
        ${n.title ? `<h3>${n.title}</h3>` : ""}
        <p>${n.message}</p>
        ${linkHtml}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
      <p>Hi {{name}},</p>
      ${items}
      <p style="color:#888;font-size:12px">
        You are receiving this because you registered for an event with
        Chennai Astronomy Club.
      </p>
    </body>
    </html>
  `;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/** Escape HTML special characters to prevent injection in email bodies. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
