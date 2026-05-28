import type { VercelRequest, VercelResponse } from "@vercel/node";

type RegistrationAction = "submit" | "cancel" | "update" | "status" | "reserve";

interface DiscourseUserSummary {
  username: string;
  email: string;
  groups: { name: string }[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const appsScriptUrl = process.env.APPS_SCRIPT_URL ?? process.env.VITE_APPS_SCRIPT_URL ?? "";
  const sheetsSecret = process.env.SHEETS_SECRET ?? process.env.VITE_SHEETS_SECRET ?? "";
  const discourseUrl = (process.env.DISCOURSE_URL ?? process.env.VITE_DISCOURSE_URL ?? "").replace(/\/+$/, "");
  const verifiedGroupName =
    process.env.VERIFIED_GROUP_NAME ?? process.env.VITE_VERIFIED_GROUP_NAME ?? "verified-members";

  if (!appsScriptUrl || !sheetsSecret || !discourseUrl) {
    return res.status(500).json({ success: false, error: "Server configuration missing" });
  }

  const userApiKey = req.headers["user-api-key"] as string | undefined;
  if (!userApiKey) return res.status(401).json({ success: false, error: "Unauthorized" });

  const sheetTab = typeof req.body?.sheetTab === "string" ? req.body.sheetTab.trim() : "";
  if (!sheetTab) return res.status(400).json({ success: false, error: "Missing sheetTab" });

  const action = normalizeAction(req.body?.action);
  if (!action) return res.status(400).json({ success: false, error: "Invalid action" });

  let user: DiscourseUserSummary;
  try {
    user = await fetchDiscourseUser(discourseUrl, userApiKey);
  } catch {
    return res.status(403).json({ success: false, error: "Failed to verify user" });
  }

  const memberType = user.groups.some((g) => g.name === verifiedGroupName)
    ? verifiedGroupName
    : "regular";

  const basePayload: Record<string, unknown> = {
    secret: sheetsSecret,
    sheetTab,
    action,
  };

  if (action === "submit") {
    const formData =
      req.body?.formData && typeof req.body.formData === "object"
        ? { ...(req.body.formData as Record<string, unknown>) }
        : {};
    delete formData.secret;
    delete formData.sheetTab;
    delete formData.action;
    delete formData.username;
    delete formData.memberType;
    formData.email = user.email;

    basePayload.username = user.username;
    basePayload.memberType = memberType;
    basePayload.email = user.email;
    basePayload.formId = req.body?.formId ?? "";
    basePayload.requiresPayment = req.body?.requiresPayment === true;

    Object.assign(basePayload, formData);
  }

  if (action === "reserve") {
    basePayload.username = user.username;
    basePayload.memberType = memberType;
    basePayload.email = user.email;
    basePayload.formId = req.body?.formId ?? "";
    basePayload.requiresPayment = req.body?.requiresPayment === true;
    basePayload.reserveFields = Array.isArray(req.body?.reserveFields)
      ? req.body.reserveFields.filter((field: unknown) => typeof field === "string")
      : [];
  }

  if (action === "cancel") {
    basePayload.email = user.email;
  }

  if (action === "update") {
    const updates =
      req.body?.updates && typeof req.body.updates === "object"
        ? { ...(req.body.updates as Record<string, unknown>) }
        : {};
    delete updates.email;
    basePayload.email = user.email;
    basePayload.updates = updates;
  }

  try {
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(basePayload),
    });

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: `Upstream error: ${response.status}` });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ success: false, error: "Failed to reach sheets backend" });
  }
}

function normalizeAction(value: unknown): RegistrationAction | null {
  if (
    value === "submit" ||
    value === "cancel" ||
    value === "update" ||
    value === "status" ||
    value === "reserve"
  ) {
    return value;
  }
  return null;
}

async function fetchDiscourseUser(
  discourseUrl: string,
  userApiKey: string
): Promise<DiscourseUserSummary> {
  const currentRes = await fetch(`${discourseUrl}/session/current.json`, {
    headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
  });
  if (!currentRes.ok) throw new Error("Forbidden");

  const currentData = await currentRes.json();
  const username: string | undefined = currentData?.current_user?.username;
  if (!username) throw new Error("Missing username");

  const profileRes = await fetch(`${discourseUrl}/u/${encodeURIComponent(username)}.json`, {
    headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
  });
  if (!profileRes.ok) throw new Error("Forbidden");

  const profileData = await profileRes.json();
  const user = profileData?.user;
  if (!user?.email) throw new Error("Missing email");

  return {
    username: user.username,
    email: user.email,
    groups: Array.isArray(user.groups) ? user.groups : [],
  };
}
