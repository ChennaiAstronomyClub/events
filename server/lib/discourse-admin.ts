export type AdminVerifyResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function discourseBaseUrl(): string {
  return (process.env.DISCOURSE_URL ?? process.env.VITE_DISCOURSE_URL ?? "").replace(
    /\/+$/,
    ""
  );
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
      headers: { "User-Api-Key": userApiKey },
    });
    if (!sessionRes.ok) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    const sessionData = (await sessionRes.json()) as {
      current_user?: { admin?: boolean };
    };
    if (!sessionData.current_user?.admin) {
      return { ok: false, status: 403, error: "Requires Discourse admin" };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 500, error: "Failed to verify admin status" };
  }
}
