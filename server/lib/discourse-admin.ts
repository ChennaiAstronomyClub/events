export type AdminVerifyResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function discourseBaseUrl(): string {
  return (process.env.DISCOURSE_URL ?? process.env.VITE_DISCOURSE_URL ?? "").replace(
    /\/+$/,
    ""
  );
}

/**
 * Normalize the Discourse User-Api-Key header.
 * Node/Vercel may expose a duplicated header as string[].
 */
export function userApiKeyFromHeaders(headers: {
  "user-api-key"?: string | string[] | undefined;
}): string | undefined {
  const raw = headers["user-api-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Verify the caller's Discourse User API Key belongs to an admin account. */
export async function verifyDiscourseAdmin(
  userApiKey: string | undefined
): Promise<AdminVerifyResult> {
  if (!userApiKey) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const discourseUrl = discourseBaseUrl();
  if (!discourseUrl) {
    return { ok: false, status: 500, error: "Server configuration missing" };
  }

  try {
    const sessionRes = await fetch(`${discourseUrl}/session/current.json`, {
      headers: { "User-Api-Key": userApiKey, Accept: "application/json" },
    });
    if (!sessionRes.ok) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    const sessionData = (await sessionRes.json()) as {
      current_user?: { admin?: boolean };
    };
    // Discourse also has moderator/staff. Only site admin is allowed.
    if (sessionData.current_user?.admin !== true) {
      return { ok: false, status: 403, error: "Requires Discourse admin" };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 500, error: "Failed to verify admin status" };
  }
}
