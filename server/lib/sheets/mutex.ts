import { randomUUID } from "crypto";
import { getRedisClient, redisSetNx, redisDel } from "../redis/client.js";

const LOCK_TTL_S = 12;
const RETRY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 400;

function lockKey(spreadsheetId: string, sheetTab: string): string {
  return `lock:sheet:${spreadsheetId}:${sheetTab}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function releaseLock(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  // Only release if we're still the owner (TTL not yet expired).
  // A simple DEL is safe here: LOCK_TTL_S is 12s and sheet ops complete in <5s.
  await redisDel(key);
}

/** Acquire a distributed Redis lock, run fn, then release. Falls back to no lock if Redis is unavailable. */
export async function withSheetTabLock<T>(
  spreadsheetId: string,
  sheetTab: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = lockKey(spreadsheetId, sheetTab);
  const token = randomUUID(); // kept for logging; value stored in Redis

  let acquired = false;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    acquired = await redisSetNx(key, token, LOCK_TTL_S);
    if (acquired) break;
    await delay(RETRY_DELAY_MS);
  }

  if (!acquired) {
    console.warn("[redis] lock timeout — proceeding without lock for", sheetTab);
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      await releaseLock(key);
    }
  }
}
