import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  dispatchRegistration,
  isSheetsApiConfigured,
  type RegistrationAction,
} from "../server/lib/sheets/index.js";
import { mapSheetsError } from "../server/lib/sheets/errors.js";
import "../server/lib/sheets/client.js";
import {
  GUEST_REGISTRATION_FORM_IDS,
  WHITELIST_REGISTRATION_FORM_IDS,
  expectedSheetTabForForm,
  formRequiresPayment,
  isWhitelistUnpaidForm,
} from "../server/lib/sheets/config.js";
import { matchesRegistrationWhitelist, normalizeWhitelistEmail, normalizeWhitelistPhone } from "../server/lib/sheets/whitelist.js";
import {
  registrationWhitelistForForm,
  resolveInviteToken,
} from "../server/lib/sheets/registration-whitelist.js";
import type { InviteTokenClaims } from "../server/lib/sheets/invite-token.js";
import {
  createHoldToken,
  resolveHoldToken,
  invalidateHoldToken,
} from "../server/lib/sheets/hold-token.js";
import { redisGet, redisSet } from "../server/lib/redis/client.js";
import {
  checkRateLimit,
  clientIpFromHeaders,
} from "../server/lib/redis/rate-limit.js";
import { userApiKeyFromHeaders } from "../server/lib/discourse-admin.js";
import { captureServerException } from "../server/lib/sentry.js";
import { SheetLockError } from "../server/lib/sheets/mutex.js";

const DISCOURSE_CACHE_TTL_S = 60;
const GUEST_RATE_LIMIT = 30;
const GUEST_RATE_WINDOW_S = 60;

const GENERIC_CONFIG_MESSAGE =
  "Registration is temporarily unavailable. Please try again in a few minutes.";

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
  "status",
];

const GUEST_ACTIONS: RegistrationAction[] = [
  "submit",
  "releaseHold",
  "reserve",
  "status",
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const discourseUrl = (process.env.DISCOURSE_URL ?? process.env.VITE_DISCOURSE_URL ?? "").replace(/\/+$/, "");
  const verifiedGroupName =
    process.env.VERIFIED_GROUP_NAME ?? process.env.VITE_VERIFIED_GROUP_NAME ?? "verified-members";

  if (!discourseUrl) {
    return res.status(500).json({ success: false, error: "Server configuration missing" });
  }

  const body = req.body as Record<string, unknown> | undefined;
  const actionRaw = typeof body?.action === "string" ? body.action.trim() : "";

  // Whitelist check never returns the list itself. Env + sheet are merged server-side.
  if (actionRaw === "whitelistCheck") {
    return handleWhitelistCheck(req, res, discourseUrl, body ?? {});
  }

  if (!isSheetsApiConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Server configuration missing",
      message: GENERIC_CONFIG_MESSAGE,
    });
  }

  const sheetTab = typeof body?.sheetTab === "string" ? body.sheetTab.trim() : "";
  if (!sheetTab) return res.status(400).json({ success: false, error: "Missing sheetTab" });

  const action = normalizeAction(body?.action);
  if (!action) return res.status(400).json({ success: false, error: "Invalid action" });

  const formId = typeof body?.formId === "string" ? body.formId.trim() : "";
  const tabMismatch = validateFormSheetBinding(formId, sheetTab);
  if (tabMismatch) return res.status(400).json(tabMismatch);

  const userApiKey = userApiKeyFromHeaders(req.headers);
  const isOpenGuestForm = formId.length > 0 && GUEST_REGISTRATION_FORM_IDS.has(formId);

  // Resolve invite once per request; reuse for auth, identity checks, and phone seal.
  const inviteToken =
    typeof body?.invite === "string" && body.invite.trim() ? body.invite.trim() : undefined;
  const inviteClaims =
    !userApiKey && formId && inviteToken
      ? await resolveInviteToken(inviteToken, formId)
      : null;

  const whitelistGuestOk = Boolean(
    !userApiKey &&
      formId &&
      WHITELIST_REGISTRATION_FORM_IDS.has(formId) &&
      inviteClaims
  );
  const isGuestRequest = Boolean(!userApiKey && (isOpenGuestForm || whitelistGuestOk));

  if (!userApiKey && !isGuestRequest) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  if (isGuestRequest && !GUEST_ACTIONS.includes(action)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  if (isGuestRequest && (action === "cancel" || action === "update")) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  // Rate-limit unauthenticated guest mutating/check paths.
  if (isGuestRequest && (action === "reserve" || action === "submit" || action === "status")) {
    const ip = clientIpFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const limited = await checkRateLimit(
      `rl:guest:${action}:${ip}`,
      GUEST_RATE_LIMIT,
      GUEST_RATE_WINDOW_S
    );
    if (!limited.allowed) {
      return res.status(429).json({
        success: false,
        error: "rate_limited",
        message: "Too many requests. Please wait a moment and try again.",
      });
    }
  }

  let user: DiscourseUserSummary;
  let memberType: string;
  let holdTokenForRelease: string | undefined;

  if (isGuestRequest) {
    const guestResolved = await resolveGuestUser(
      body ?? {},
      action,
      formId,
      sheetTab,
      res,
      inviteClaims
    );
    if (!guestResolved) return;
    user = guestResolved.user;
    memberType = "guest";
    holdTokenForRelease = guestResolved.holdToken;
  } else {
    const resolved = await resolveRegistrationUser(
      body,
      discourseUrl,
      userApiKey!,
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
    const submitBody = buildSubmitBody(body, user, memberType, action);
    const phone =
      typeof body?.phone === "string" && body.phone.trim()
        ? body.phone.trim()
        : undefined;
    let submitWithPhone =
      phone && !(typeof submitBody.phone === "string" && submitBody.phone.trim())
        ? { ...submitBody, phone }
        : submitBody;

    // Seal sheet identity onto the write payload when the invite carries it.
    if (action === "submit" && inviteClaims?.phone) {
      submitWithPhone = { ...submitWithPhone, phone: inviteClaims.phone };
    }

    const withInvite = (payload: Record<string, unknown>) =>
      inviteToken ? { ...payload, invite: inviteToken } : payload;
    const result = await dispatchRegistration({
      action,
      sheetTab,
      user: { username: user.username, email: user.email, memberType },
      body:
        action === "submit"
          ? withInvite(submitWithPhone)
          : action === "update"
            ? { updates: body?.updates, sheetTab, formId }
            : withInvite({
                formId: formId || "",
                requiresPayment: formRequiresPayment(formId),
                ...(phone ? { phone } : {}),
              }),
    });

    if (isGuestRequest && action === "reserve" && result.success) {
      const email = user.email;
      const expiresAt =
        typeof result.expiresAt === "string" ? result.expiresAt : "";
      if (email && expiresAt) {
        const holdToken = await createHoldToken(sheetTab, formId, email, expiresAt);
        return res.status(200).json({ ...result, holdToken });
      }
    }

    if (isGuestRequest && action === "releaseHold" && result.success && holdTokenForRelease) {
      await invalidateHoldToken(holdTokenForRelease);
    }

    if (isGuestRequest && action === "submit" && result.success) {
      const holdToken =
        typeof body?.holdToken === "string" ? body.holdToken.trim() : "";
      if (holdToken) await invalidateHoldToken(holdToken);
    }

    return res.status(200).json(result);
  } catch (err: unknown) {
    if (err instanceof SheetLockError) {
      return res.status(503).json({
        success: false,
        error: err.code,
        message: err.message,
      });
    }
    const mapped = mapSheetsError(err);
    console.error("[registrations] Sheets API:", mapped.body.error, mapped.body.message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    await captureServerException(err);
    return res.status(mapped.status).json({
      ...mapped.body,
      message: GENERIC_CONFIG_MESSAGE,
    });
  }
}

function validateFormSheetBinding(
  formId: string,
  sheetTab: string
): { success: false; error: string; message?: string } | null {
  if (!formId) {
    return {
      success: false,
      error: "missing_form_id",
      message: "Missing formId.",
    };
  }
  const expected = expectedSheetTabForForm(formId);
  if (!expected) {
    return {
      success: false,
      error: "unknown_form_id",
      message: "Unknown form.",
    };
  }
  if (expected !== sheetTab) {
    return {
      success: false,
      error: "sheet_tab_mismatch",
      message: "sheetTab does not match formId.",
    };
  }
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Guest may register on a non-open-guest form only with a valid opaque invite token. */
async function inviteClaimsFromBody(formId: string, body: Record<string, unknown>) {
  const token = typeof body.invite === "string" ? body.invite.trim() : "";
  return resolveInviteToken(token, formId);
}

function phoneFromRegistrationBody(body: Record<string, unknown>): string | null {
  if (typeof body.phone === "string" && body.phone.trim()) {
    return body.phone.trim();
  }
  const formData =
    body.formData && typeof body.formData === "object"
      ? (body.formData as Record<string, unknown>)
      : null;
  if (formData && typeof formData.phone === "string" && formData.phone.trim()) {
    return formData.phone.trim();
  }
  return null;
}

function emailFromRegistrationBody(body: Record<string, unknown>): string | null {
  const guest = parseGuestUser(body);
  if (guest?.email) return guest.email.trim();
  if (typeof body.email === "string" && body.email.trim()) return body.email.trim();
  const formData =
    body.formData && typeof body.formData === "object"
      ? (body.formData as Record<string, unknown>)
      : null;
  if (formData && typeof formData.email === "string" && formData.email.trim()) {
    return formData.email.trim();
  }
  return null;
}

/**
 * Enforce that submitted identity matches whatever the invite row sealed
 * (email, phone, or both).
 * - Email on invite: any submitted email must match; registration uses invite email.
 * - Phone on invite: submitted phone is required and must match (normalized).
 */
function inviteIdentityMismatch(
  claims: InviteTokenClaims,
  submitted: { email?: string | null; phone?: string | null }
): { error: string; message: string } | null {
  if (claims.email) {
    const submittedEmail = submitted.email?.trim() ?? "";
    if (
      submittedEmail &&
      normalizeWhitelistEmail(submittedEmail) !== normalizeWhitelistEmail(claims.email)
    ) {
      return {
        error: "email_mismatch",
        message: "Form email must match the invite email.",
      };
    }
  }
  if (claims.phone) {
    const submittedPhone = submitted.phone?.trim() ?? "";
    if (
      !submittedPhone ||
      normalizeWhitelistPhone(submittedPhone) !== normalizeWhitelistPhone(claims.phone)
    ) {
      return {
        error: "phone_mismatch",
        message: "Form phone must match the invite phone.",
      };
    }
  }
  return null;
}

async function resolveGuestUser(
  body: Record<string, unknown>,
  action: RegistrationAction,
  formId: string,
  sheetTab: string,
  res: VercelResponse,
  pretfetchedClaims: InviteTokenClaims | null = null
): Promise<{ user: DiscourseUserSummary; holdToken?: string } | null> {
  const isOpenGuest = GUEST_REGISTRATION_FORM_IDS.has(formId);
  const isWhitelistForm = WHITELIST_REGISTRATION_FORM_IDS.has(formId);
  if (!isOpenGuest && !isWhitelistForm) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return null;
  }

  if (action === "status") {
    const guestUser = parseGuestUser(body);
    const email =
      guestUser?.email && isValidEmail(guestUser.email) ? guestUser.email : "";
    return { user: { username: "", email, groups: [] } };
  }

  const claims =
    pretfetchedClaims ?? (await inviteClaimsFromBody(formId, body));
  // Whitelist-only (non-open) guests must present a resolvable invite.
  if (!isOpenGuest && isWhitelistForm && !claims) {
    res.status(403).json({
      success: false,
      error: "Forbidden",
      message: "This invite is not authorized for registration.",
    });
    return null;
  }

  if (action === "reserve") {
    const guestUser = parseGuestUser(body);
    const submittedEmail = guestUser?.email ?? null;
    const submittedPhone = phoneFromRegistrationBody(body);

    if (claims) {
      const mismatch = inviteIdentityMismatch(claims, {
        email: submittedEmail,
        phone: submittedPhone,
      });
      if (mismatch) {
        res.status(400).json({ success: false, ...mismatch });
        return null;
      }
    }

    const email = claims?.email || submittedEmail;
    if (!email || !isValidEmail(email)) {
      res.status(400).json({
        success: false,
        error: "invalid_guest_email",
        message: "A valid email is required to reserve a seat.",
      });
      return null;
    }
    return {
      user: {
        username: "",
        email,
        groups: [],
      },
    };
  }

  // Hold-less guest submit — only for server-known unpaid whitelist forms (never trust client requiresPayment).
  if (action === "submit" && isWhitelistUnpaidForm(formId)) {
    const submittedEmail = emailFromRegistrationBody(body);
    const submittedPhone = phoneFromRegistrationBody(body);

    if (claims) {
      const mismatch = inviteIdentityMismatch(claims, {
        email: submittedEmail,
        phone: submittedPhone,
      });
      if (mismatch) {
        res.status(400).json({ success: false, ...mismatch });
        return null;
      }
    }

    const email = claims?.email || submittedEmail;
    if (!email || !isValidEmail(email)) {
      res.status(400).json({
        success: false,
        error: "invalid_guest_email",
        message: "A valid email is required to register.",
      });
      return null;
    }
    return {
      user: { username: "", email, groups: [] },
    };
  }

  const holdToken = typeof body.holdToken === "string" ? body.holdToken.trim() : "";
  if (!holdToken) {
    res.status(400).json({
      success: false,
      error: "missing_hold_token",
      message: "Missing hold token. Please open the registration form again.",
    });
    return null;
  }

  const resolved = await resolveHoldToken(holdToken, sheetTab, formId);
  if (!resolved) {
    res.status(403).json({
      success: false,
      error: "invalid_hold_token",
      message: "Your seat hold expired or is invalid. Please try again.",
    });
    return null;
  }

  if (action === "submit") {
    const formData =
      body.formData && typeof body.formData === "object"
        ? (body.formData as Record<string, unknown>)
        : {};
    const formEmail =
      typeof formData.email === "string" ? formData.email.trim().toLowerCase() : "";
    if (!formEmail || formEmail !== resolved.email.toLowerCase()) {
      res.status(400).json({
        success: false,
        error: "email_mismatch",
        message: "Form email must match the email used to reserve your seat.",
      });
      return null;
    }

    if (claims) {
      const mismatch = inviteIdentityMismatch(claims, {
        email: formEmail,
        phone: phoneFromRegistrationBody(body),
      });
      if (mismatch) {
        res.status(400).json({ success: false, ...mismatch });
        return null;
      }
    }
  }

  return {
    user: { username: "", email: resolved.email, groups: [] },
    holdToken,
  };
}

function parseGuestUser(body: Record<string, unknown>): { email: string } | null {
  const raw = body.guestUser;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.email !== "string") return null;
  const email = o.email.trim();
  return email ? { email } : null;
}

function shouldVerifyDiscourseOnRegistration(): boolean {
  // Production always verifies — ignore disable flag.
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "production") return true;
  if (process.env.NODE_ENV?.trim().toLowerCase() === "production" && !vercelEnv) {
    return true;
  }

  const raw = process.env.VERIFY_DISCOURSE_ON_REGISTRATION?.trim().toLowerCase();
  // Fail closed: verify unless explicitly disabled (local/dev only).
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function discourseCacheKey(kind: "session" | "user", userApiKey: string): string {
  const hash = createHash("sha256").update(userApiKey).digest("hex");
  return `discourse:${kind}:${hash}`;
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
      const user = await resolveDiscourseUser(discourseUrl, userApiKey);
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
    requiresPayment: formRequiresPayment(typeof body?.formId === "string" ? body.formId : ""),
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

/**
 * Returns whether the identity may bypass closed/full registration.
 * Uses env ∪ sheet identities for logged-in users; guests need a valid invite token.
 * Never returns the list itself.
 */
async function handleWhitelistCheck(
  req: VercelRequest,
  res: VercelResponse,
  discourseUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  if (!formId || !expectedSheetTabForForm(formId)) {
    res.status(400).json({ success: false, error: "unknown_form_id", message: "Unknown form." });
    return;
  }

  const ip = clientIpFromHeaders(req.headers as Record<string, string | string[] | undefined>);
  const limited = await checkRateLimit(
    `rl:guest:whitelistCheck:${ip}`,
    GUEST_RATE_LIMIT,
    GUEST_RATE_WINDOW_S
  );
  if (!limited.allowed) {
    res.status(429).json({
      success: false,
      error: "rate_limited",
      message: "Too many requests. Please wait a moment and try again.",
    });
    return;
  }

  const userApiKey = userApiKeyFromHeaders(req.headers);

  if (!userApiKey) {
    const invite = typeof body.invite === "string" ? body.invite.trim() : "";
    const claims = await resolveInviteToken(invite, formId);
    res.status(200).json({
      success: true,
      allowed: Boolean(claims),
      ...(claims?.email ? { email: claims.email } : {}),
      ...(claims?.phone ? { phone: claims.phone } : {}),
    });
    return;
  }

  const whitelist = await registrationWhitelistForForm(formId);
  if (!whitelist) {
    res.status(200).json({ success: true, allowed: false });
    return;
  }

  const resolved = await resolveRegistrationUser(
    body,
    discourseUrl,
    userApiKey,
    "submit",
    res
  );
  if (!resolved) return;

  const allowed = matchesRegistrationWhitelist(whitelist, {
    // Authenticated checks use Discourse email only — ignore client phone spoofing.
    email: resolved.user.email,
    phone: null,
  });

  res.status(200).json({ success: true, allowed });
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
  userApiKey: string
): Promise<DiscourseUserSummary> {
  const cacheKey = discourseCacheKey("user", userApiKey);
  const cached = await redisGet<DiscourseUserSummary>(cacheKey);
  if (cached) return cached;

  const session = await fetchDiscourseSession(discourseUrl, userApiKey);
  const user: DiscourseUserSummary =
    session.email && session.groups
      ? {
          username: session.username,
          email: session.email,
          groups: session.groups,
        }
      : await fetchDiscourseProfile(discourseUrl, userApiKey, session.username);

  await redisSet(cacheKey, user, DISCOURSE_CACHE_TTL_S);
  await redisSet(discourseCacheKey("session", userApiKey), "1", DISCOURSE_CACHE_TTL_S);
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
