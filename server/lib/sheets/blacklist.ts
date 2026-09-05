import { redisGet, redisSet } from "../redis/client.js";
import { BLACKLIST_CACHE_TTL_S, blacklistSheetTab } from "./config.js";
import { createRepository } from "./repository.js";
import { findHeaderIndex0 } from "./utils.js";
import {
  normalizeWhitelistEmail,
  normalizeWhitelistPhone,
} from "./whitelist.js";

const CACHE_KEY = "blacklist:v1";

const EMAIL_HEADERS = ["email", "email id", "email address"];
const PHONE_HEADERS = ["phone", "phone number", "contact number", "mobile"];
const USERNAME_HEADERS = [
  "username",
  "discourse",
  "discourse username",
  "discourse account",
];

export interface BlacklistIdentity {
  email?: string | null;
  phone?: string | null;
  username?: string | null;
}

export interface BlacklistIndex {
  emails: string[];
  phones: string[];
  usernames: string[];
}

export function normalizeBlacklistUsername(username: string): string {
  return username.trim().toLowerCase();
}

function firstHeaderIndex(headers: string[], names: string[]): number {
  for (const name of names) {
    const idx = findHeaderIndex0(headers, name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function cellString(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseBlacklistIndex(
  headers: string[],
  rows: unknown[][]
): BlacklistIndex {
  const emailCol = firstHeaderIndex(headers, EMAIL_HEADERS);
  const phoneCol = firstHeaderIndex(headers, PHONE_HEADERS);
  const usernameCol = firstHeaderIndex(headers, USERNAME_HEADERS);

  const emails = new Set<string>();
  const phones = new Set<string>();
  const usernames = new Set<string>();

  for (const row of rows) {
    if (emailCol !== -1) {
      const email = normalizeWhitelistEmail(cellString(row[emailCol]));
      if (email) emails.add(email);
    }
    if (phoneCol !== -1) {
      const phone = normalizeWhitelistPhone(cellString(row[phoneCol]));
      if (phone) phones.add(phone);
    }
    if (usernameCol !== -1) {
      const username = normalizeBlacklistUsername(cellString(row[usernameCol]));
      if (username) usernames.add(username);
    }
  }

  return {
    emails: [...emails],
    phones: [...phones],
    usernames: [...usernames],
  };
}

export function matchesBlacklist(
  index: BlacklistIndex,
  identity: BlacklistIdentity
): boolean {
  const email = identity.email ? normalizeWhitelistEmail(identity.email) : "";
  if (email && index.emails.includes(email)) return true;

  const phone = identity.phone ? normalizeWhitelistPhone(identity.phone) : "";
  if (phone && index.phones.includes(phone)) return true;

  const username = identity.username
    ? normalizeBlacklistUsername(identity.username)
    : "";
  if (username && index.usernames.includes(username)) return true;

  return false;
}

function isMissingTabError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("unable to parse range") ||
    lower.includes("sheet tab not found") ||
    lower.includes("unable to parse")
  );
}

async function loadBlacklistIndexFromSheet(): Promise<BlacklistIndex | null> {
  const tab = blacklistSheetTab();
  try {
    const repo = createRepository(tab);
    const data = await repo.readSheetData();
    return parseBlacklistIndex(data.headers, data.rows);
  } catch (err) {
    if (isMissingTabError(err)) {
      console.error(
        `[blacklist] Sheet tab "${tab}" was not found. Allowing registration (fail open).`
      );
      return null;
    }
    console.error("[blacklist] Failed to read blacklist sheet (fail open):", err);
    return null;
  }
}

async function getBlacklistIndex(): Promise<BlacklistIndex | null> {
  const cached = await redisGet<BlacklistIndex>(CACHE_KEY);
  if (
    cached &&
    Array.isArray(cached.emails) &&
    Array.isArray(cached.phones) &&
    Array.isArray(cached.usernames)
  ) {
    return cached;
  }

  const index = await loadBlacklistIndexFromSheet();
  if (!index) return null;

  await redisSet(CACHE_KEY, index, BLACKLIST_CACHE_TTL_S);
  return index;
}

/** True when email, phone, or Discourse username is on the Blacklist tab. */
export async function isIdentityBlacklisted(
  identity: BlacklistIdentity
): Promise<boolean> {
  const hasAny =
    Boolean(identity.email?.trim()) ||
    Boolean(identity.phone?.trim()) ||
    Boolean(identity.username?.trim());
  if (!hasAny) return false;

  const index = await getBlacklistIndex();
  if (!index) return false;
  return matchesBlacklist(index, identity);
}
