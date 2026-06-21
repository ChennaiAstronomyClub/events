import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  dispatchRegistration,
  isSheetsApiConfigured,
  type RegistrationAction,
} from "../server/lib/sheets/index.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";
import "../server/lib/sheets/client.js";
import { redisGet, redisSet } from "../server/lib/redis/client.js";

const DISCOURSE_CACHE_TTL_S = 60;

interface DiscourseUserSummary {
  username: string;
  email: string;
  groups: { name: string }[];
}

/** Actions that need username/email from the client when Discourse verify is off. */
const ACTIONS_NEEDING_USER: RegistrationAction[] = [
  "submit",
  "cancel",
  "releaseHold",
  "update",
  "reserve",
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const discourseUrl = (process.env.DISCOURSE_URL ?? process.env.VITE_DISCOURSE_URL ?? "").replace(/\/+$/, "");
  const verifiedGroupName =
    process.env.VERIFIED_GROUP_NAME ?? process.env.VITE_VERIFIED_GROUP_NAME ?? "verified-members";

  if (!discourseUrl) {
    return res.status(500).json({ success: false, error: "Server configuration missing" });
  }
  if (!isSheetsApiConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Server configuration missing",
      message:
        "Configure Google Sheets API: GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY).",
    });
  }

  const userApiKey = req.headers["user-api-key"] as string | undefined;
  if (!userApiKey) return res.status(401).json({ success: false, error: "Unauthorized" });

  const sheetTab = typeof req.body?.sheetTab === "string" ? req.body.sheetTab.trim() : "";
  if (!sheetTab) return res.status(400).json({ success: false, error: "Missing sheetTab" });

  const action = normalizeAction(req.body?.action);
  if (!action) return res.status(400).json({ success: false, error: "Invalid action" });

  let user: DiscourseUserSummary;
  let memberType: string;

  if (action === "status") {
    user = { username: "", email: "", groups: [] };
    memberType = "regular";
    if (shouldVerifyDiscourseOnRegistration()) {
      try {
        await verifyDiscourseApiKeyCached(discourseUrl, userApiKey);
      } catch {
        return res.status(403).json({ success: false, error: "Failed to verify user" });
      }
    }
  } else {
    const resolved = await resolveRegistrationUser(
      req.body,
      discourseUrl,
      userApiKey,
      action,
      res
    );
    if (!resolved) return;
    user = resolved.user;
    memberType = user.groups.some((g) => g.name === verifiedGroupName)
      ? verifiedGroupName
      : "regular";
  }

  try {
    const submitBody = buildSubmitBody(req.body, user, memberType, action);
    const result = await dispatchRegistration({
      action,
      sheetTab,
      user: { username: user.username, email: user.email, memberType },
      body:
        action === "submit"
          ? submitBody
          : action === "update"
            ? { updates: req.body?.updates, sheetTab }
            : {
                formId: req.body?.formId ?? "",
                requiresPayment: req.body?.requiresPayment === true,
              },
    });
    return res.status(200).json(result);
  } catch (err: unknown) {
    const mapped = mapSheetsError(err);
    console.error("[registrations] Sheets API:", mapped.body.error, mapped.body.message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    return res.status(mapped.status).json(mapped.body);
  }
}

function shouldVerifyDiscourseOnRegistration(): boolean {
  const raw = process.env.VERIFY_DISCOURSE_ON_REGISTRATION?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

async function resolveRegistrationUser(
  body: unknown,
  discourseUrl: string,
  userApiKey: string,
  action: RegistrationAction,
  res: VercelResponse
): Promise<{ user: DiscourseUserSummary } | null> {
  if (shouldVerifyDiscourseOnRegistration()) {
    try {
      const user = await resolveDiscourseUser(
        discourseUrl,
        userApiKey,
        parseClientDiscourseUser(body)
      );
      return { user };
    } catch {
      res.status(403).json({ success: false, error: "Failed to verify user" });
      return null;
    }
  }

  if (!ACTIONS_NEEDING_USER.includes(action)) {
    res.status(400).json({ success: false, error: "Invalid action" });
    return null;
  }

  const user = userFromClientBody(body);
  if (!user) {
    res.status(400).json({
      success: false,
      error: "missing_discourse_user",
      message:
        "Missing user identity. Log in again and retry — the app should send discourseUser with your registration request.",
    });
    return null;
  }
  return { user };
}

function userFromClientBody(body: unknown): DiscourseUserSummary | null {
  const hint = parseClientDiscourseUser(body);
  if (!hint) return null;
  return {
    username: hint.username,
    email: hint.email,
    groups: hint.groups.map((name) => ({ name })),
  };
}

function buildSubmitBody(
  body: Record<string, unknown> | undefined,
  user: DiscourseUserSummary,
  memberType: string,
  action: RegistrationAction
): Record<string, unknown> {
  if (action !== "submit") return {};
  const formData =
    body?.formData && typeof body.formData === "object"
      ? { ...(body.formData as Record<string, unknown>) }
      : {};
  delete formData.secret;
  delete formData.sheetTab;
  delete formData.action;
  delete formData.username;
  delete formData.memberType;
  formData.email = user.email;
  return {
    ...formData,
    username: user.username,
    memberType,
    email: user.email,
    formId: body?.formId ?? "",
    requiresPayment: body?.requiresPayment === true,
  };
}

function normalizeAction(value: unknown): RegistrationAction | null {
  if (
    value === "submit" ||
    value === "cancel" ||
    value === "releaseHold" ||
    value === "update" ||
    value === "status" ||
    value === "reserve"
  ) {
    return value;
  }
  return null;
}

async function verifyDiscourseApiKeyCached(
  discourseUrl: string,
  userApiKey: string
): Promise<void> {
  const cacheKey = `discourse:session:${userApiKey}`;
  const cached = await redisGet<string>(cacheKey);
  if (cached) return;

  const currentRes = await fetch(`${discourseUrl}/session/current.json`, {
    headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
  });
  if (!currentRes.ok) throw new Error("Forbidden");

  const currentData = await currentRes.json();
  if (!currentData?.current_user?.username) throw new Error("Missing username");

  await redisSet(cacheKey, "1", DISCOURSE_CACHE_TTL_S);
}

interface ClientDiscourseHint {
  username: string;
  email: string;
  groups: string[];
}

function parseClientDiscourseUser(body: unknown): ClientDiscourseHint | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).discourseUser;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.username !== "string" || typeof o.email !== "string") return null;
  const username = o.username.trim();
  const email = o.email.trim();
  if (!username || !email) return null;
  return {
    username,
    email,
    groups: Array.isArray(o.groups)
      ? o.groups.filter((g): g is string => typeof g === "string" && g.length > 0)
      : [],
  };
}

async function resolveDiscourseUser(
  discourseUrl: string,
  userApiKey: string,
  clientHint: ClientDiscourseHint | null
): Promise<DiscourseUserSummary> {
  const cacheKey = `discourse:user:${userApiKey}`;
  const cached = await redisGet<DiscourseUserSummary>(cacheKey);
  if (cached) return cached;

  const session = await fetchDiscourseSession(discourseUrl, userApiKey);
  let user: DiscourseUserSummary;

  if (session.email) {
    user = {
      username: session.username,
      email: session.email,
      groups: session.groups ?? [],
    };
  } else if (clientHint && clientHint.username === session.username) {
    user = {
      username: clientHint.username,
      email: clientHint.email,
      groups: clientHint.groups.map((name) => ({ name })),
    };
  } else {
    user = await fetchDiscourseProfile(discourseUrl, userApiKey, session.username);
  }

  await redisSet(cacheKey, user, DISCOURSE_CACHE_TTL_S);
  await redisSet(`discourse:session:${userApiKey}`, "1", DISCOURSE_CACHE_TTL_S);
  return user;
}

async function fetchDiscourseSession(
  discourseUrl: string,
  userApiKey: string
): Promise<{ username: string; email?: string; groups?: { name: string }[] }> {
  const currentRes = await fetch(`${discourseUrl}/session/current.json`, {
    headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
  });
  if (!currentRes.ok) throw new Error("Forbidden");

  const currentData = await currentRes.json();
  const cu = currentData?.current_user as Record<string, unknown> | undefined;
  const username = typeof cu?.username === "string" ? cu.username : undefined;
  if (!username) throw new Error("Missing username");

  const email = typeof cu?.email === "string" ? cu.email : undefined;
  const groups = Array.isArray(cu?.groups)
    ? (cu.groups as { name?: string }[])
        .map((g) => ({ name: String(g.name ?? "") }))
        .filter((g) => g.name.length > 0)
    : undefined;

  return { username, email, groups };
}

async function fetchDiscourseProfile(
  discourseUrl: string,
  userApiKey: string,
  username: string
): Promise<DiscourseUserSummary> {
  const profileRes = await fetch(`${discourseUrl}/u/${encodeURIComponent(username)}.json`, {
    headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
  });
  if (!profileRes.ok) throw new Error("Forbidden");

  const profileData = await profileRes.json();
  const profileUser = profileData?.user;
  if (!profileUser?.email) throw new Error("Missing email");

  return {
    username: profileUser.username,
    email: profileUser.email,
    groups: Array.isArray(profileUser.groups) ? profileUser.groups : [],
  };
}
