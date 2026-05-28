import { STATUS_CACHE_TTL_MS } from "./config.js";
import { redisGet, redisSet, redisDel } from "../redis/client.js";

const TTL_S = Math.ceil(STATUS_CACHE_TTL_MS / 1000);

function key(sheetTab: string): string {
  return `status:${sheetTab}`;
}

export async function getStatusCache(
  sheetTab: string
): Promise<Record<string, unknown> | null> {
  return redisGet<Record<string, unknown>>(key(sheetTab));
}

export async function setStatusCache(
  sheetTab: string,
  body: Record<string, unknown>
): Promise<void> {
  await redisSet(key(sheetTab), body, TTL_S);
}

export async function invalidateStatusCache(sheetTab: string): Promise<void> {
  await redisDel(key(sheetTab));
}
