import { randomUUID } from "crypto";
import { getRedisClient, redisSetNx, redisDel } from "../redis/client.js";

const LOCK_TTL_S = 12;
const RETRY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 400;

export class SheetLockError extends Error {
  readonly code = "sheet_lock_unavailable";

  constructor(message = "Registration is busy. Please try again in a moment.") {
    super(message);
    this.name = "SheetLockError";
  }
}

function lockKey(spreadsheetId: string, sheetTab: string): string {
  return `lock:sheet:${spreadsheetId}:${sheetTab}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProductionRuntime(): boolean {
  const vercel = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercel === "production") return true;
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

async function releaseLock(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await redisDel(key);
}

/**
 * Acquire a distributed Redis lock, run fn, then release.
 * Fail-closed when the lock cannot be acquired (or Redis is missing in production).
 * Non-production without Redis proceeds without a lock so local Sheets testing still works.
 */
export async function withSheetTabLock<T>(
  spreadsheetId: string,
  sheetTab: string,
  fn: () => Promise<T>
): Promise<T> {
  const redis = getRedisClient();
  if (!redis) {
    if (isProductionRuntime()) {
      throw new SheetLockError();
    }
    console.warn("[redis] no client — proceeding without lock for", sheetTab);
    return await fn();
  }

  const key = lockKey(spreadsheetId, sheetTab);
  const token = randomUUID();

  let acquired = false;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    acquired = await redisSetNx(key, token, LOCK_TTL_S);
    if (acquired) break;
    await delay(RETRY_DELAY_MS);
  }

  if (!acquired) {
    throw new SheetLockError();
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key);
  }
}
