import { randomUUID } from "crypto";
import { PENDING_SEAT_HOLD_MS } from "./config.js";
import { redisGet, redisSet, redisDel } from "../redis/client.js";

export interface HoldTokenEntry {
  email: string;
  sheetTab: string;
  formId: string;
  expiresAtMs: number;
}

const TTL_S = Math.ceil(PENDING_SEAT_HOLD_MS / 1000);

function tokenKey(token: string): string {
  return `hold-token:${token}`;
}

export async function createHoldToken(
  sheetTab: string,
  formId: string,
  email: string,
  expiresAt: string
): Promise<string> {
  const token = randomUUID();
  const expiresAtMs = new Date(expiresAt).getTime();
  const entry: HoldTokenEntry = {
    email: email.trim().toLowerCase(),
    sheetTab,
    formId,
    expiresAtMs: Number.isNaN(expiresAtMs)
      ? Date.now() + PENDING_SEAT_HOLD_MS
      : expiresAtMs,
  };
  await redisSet(tokenKey(token), entry, TTL_S);
  return token;
}

export async function resolveHoldToken(
  token: string,
  expectedSheetTab: string,
  expectedFormId: string
): Promise<{ email: string } | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const entry = await redisGet<HoldTokenEntry>(tokenKey(trimmed));
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    await redisDel(tokenKey(trimmed));
    return null;
  }
  if (entry.sheetTab !== expectedSheetTab || entry.formId !== expectedFormId) {
    return null;
  }
  return { email: entry.email };
}

export async function invalidateHoldToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed) await redisDel(tokenKey(trimmed));
}
