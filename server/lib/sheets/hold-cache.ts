import { HOLD_CACHE_TTL_MS } from "./config.js";
import { redisGet, redisSet, redisDel } from "../redis/client.js";

export interface HoldCacheEntry {
  row: number;
  expiresAt: string;
  activeCount: number;
  expiresAtMs: number;
}

const TTL_S = Math.ceil(HOLD_CACHE_TTL_MS / 1000);

function key(sheetTab: string, email: string): string {
  return `hold:${sheetTab}:${email.toLowerCase()}`;
}

export async function getHoldCache(
  sheetTab: string,
  email: string
): Promise<HoldCacheEntry | null> {
  const entry = await redisGet<HoldCacheEntry>(key(sheetTab, email));
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    await redisDel(key(sheetTab, email));
    return null;
  }
  return entry;
}

export async function setHoldCache(
  sheetTab: string,
  email: string,
  payload: { row: number; expiresAt: string; activeCount: number }
): Promise<void> {
  const expiresAtMs = new Date(payload.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) return;

  const entry: HoldCacheEntry = {
    row: payload.row,
    expiresAt: payload.expiresAt,
    activeCount: payload.activeCount,
    expiresAtMs: Math.min(expiresAtMs, Date.now() + HOLD_CACHE_TTL_MS),
  };
  await redisSet(key(sheetTab, email), entry, TTL_S);
}

export async function invalidateHoldCache(
  sheetTab: string,
  email: string
): Promise<void> {
  await redisDel(key(sheetTab, email));
}

/** No-op: Redis keys are scoped per-email; tab-wide invalidation isn't needed. */
export async function invalidateHoldCacheForTab(
  _sheetTab: string
): Promise<void> {
  // Individual hold keys expire via their TTL.
  // If a bulk invalidation is ever needed, use Redis SCAN with pattern hold:{sheetTab}:*
}
