import { redisExpire, redisIncr } from "./client.js";

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the window (best-effort). */
  remaining: number;
}

/**
 * Fixed-window rate limit via Redis INCR.
 * Fail-open when Redis is unavailable (availability over strict throttle).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const count = await redisIncr(key);
  if (count === null) {
    return { allowed: true, remaining: limit };
  }
  if (count === 1) {
    await redisExpire(key, windowSeconds);
  }
  const remaining = Math.max(0, limit - count);
  return { allowed: count <= limit, remaining };
}

/** Client IP from common proxy headers (Vercel / generic). */
export function clientIpFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string {
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]!.trim();
  }
  const realIp = headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return "unknown";
}
