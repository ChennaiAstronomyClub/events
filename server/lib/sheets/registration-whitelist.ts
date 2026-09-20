import {
  WHITELIST_CACHE_TTL_S,
  WHITELIST_NOTES_MAX,
  WHITELIST_REGISTRATION_FORM_IDS,
  envRegistrationWhitelistForForm,
  type RegistrationWhitelist,
  whitelistSheetTab,
} from "./config.js";
import { redisDel, redisGet, redisSet } from "../redis/client.js";
import { getSheetsClient, getSpreadsheetId, isSheetsApiConfigured } from "./client.js";
import { createRepository } from "./repository.js";
import { withSheetTabLock } from "./mutex.js";
import { findHeaderIndex0, formatSheetDateTime, sanitizeCell } from "./utils.js";
import {
  normalizeWhitelistEmail,
  normalizeWhitelistPhone,
} from "./whitelist.js";

export const WHITELIST_COLUMNS = [
  "Form ID",
  "Email",
  "Phone",
  "Notes",
  "Added By",
  "Added At",
  "Status",
] as const;

const CACHE_KEY = "registration-whitelist:v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WhitelistEntrySource = "env" | "sheet";

export interface AdminWhitelistEntry {
  source: WhitelistEntrySource;
  email: string;
  phone: string;
  notes?: string;
  addedBy?: string;
  addedAt?: string;
  sheetRow?: number;
}

interface SheetWhitelistRow {
  sheetRow: number;
  formId: string;
  email: string;
  phone: string;
  notes: string;
  addedBy: string;
  addedAt: string;
  status: string;
}

type AddResult =
  | { success: true; entry: AdminWhitelistEntry }
  | { success: false; error: string; message: string };

type RemoveResult =
  | { success: true; sheetRow: number }
  | { success: false; error: string; message: string };

function uniqueNormalized(values: string[], normalize: (v: string) => string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function mergeWhitelists(
  ...parts: Array<RegistrationWhitelist | undefined>
): RegistrationWhitelist | undefined {
  const emails = uniqueNormalized(
    parts.flatMap((part) => part?.emails ?? []),
    normalizeWhitelistEmail
  );
  const phones = uniqueNormalized(
    parts.flatMap((part) => part?.phones ?? []),
    normalizeWhitelistPhone
  );
  if (emails.length === 0 && phones.length === 0) return undefined;
  return { emails, phones };
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

function cellString(value: unknown): string {
  return String(value ?? "").trim();
}

function isActiveStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "" || normalized === "active";
}

function parseSheetRows(
  headers: string[],
  rows: unknown[][]
): SheetWhitelistRow[] {
  const formCol = findHeaderIndex0(headers, "Form ID");
  const emailCol = findHeaderIndex0(headers, "Email");
  const phoneCol = findHeaderIndex0(headers, "Phone");
  const notesCol = findHeaderIndex0(headers, "Notes");
  const addedByCol = findHeaderIndex0(headers, "Added By");
  const addedAtCol = findHeaderIndex0(headers, "Added At");
  const statusCol = findHeaderIndex0(headers, "Status");

  const parsed: SheetWhitelistRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    parsed.push({
      sheetRow: i + 2,
      formId: formCol >= 0 ? cellString(row[formCol]) : "",
      email: emailCol >= 0 ? normalizeWhitelistEmail(cellString(row[emailCol])) : "",
      phone: phoneCol >= 0 ? normalizeWhitelistPhone(cellString(row[phoneCol])) : "",
      notes: notesCol >= 0 ? cellString(row[notesCol]) : "",
      addedBy: addedByCol >= 0 ? cellString(row[addedByCol]) : "",
      addedAt: addedAtCol >= 0 ? cellString(row[addedAtCol]) : "",
      status: statusCol >= 0 ? cellString(row[statusCol]) : "",
    });
  }
  return parsed;
}

async function loadSheetRowsFromSpreadsheet(): Promise<SheetWhitelistRow[]> {
  const tab = whitelistSheetTab();
  try {
    const repo = createRepository(tab);
    const data = await repo.readSheetData();
    if (data.headers.length === 0) return [];
    return parseSheetRows(data.headers, data.rows);
  } catch (err) {
    if (isMissingTabError(err)) return [];
    throw err;
  }
}

async function getCachedSheetRows(): Promise<SheetWhitelistRow[]> {
  const cached = await redisGet<SheetWhitelistRow[]>(CACHE_KEY);
  if (Array.isArray(cached)) return cached;

  const rows = await loadSheetRowsFromSpreadsheet();
  await redisSet(CACHE_KEY, rows, WHITELIST_CACHE_TTL_S);
  return rows;
}

async function invalidateWhitelistCache(): Promise<void> {
  await redisDel(CACHE_KEY);
}

function activeRowsForForm(rows: SheetWhitelistRow[], formId: string): SheetWhitelistRow[] {
  const key = formId.trim();
  return rows.filter(
    (row) => row.formId.trim() === key && isActiveStatus(row.status) && (row.email || row.phone)
  );
}

function sheetWhitelistFromRows(
  rows: SheetWhitelistRow[],
  formId: string
): RegistrationWhitelist | undefined {
  const active = activeRowsForForm(rows, formId);
  if (active.length === 0) return undefined;
  return mergeWhitelists({
    emails: active.map((row) => row.email).filter(Boolean),
    phones: active.map((row) => row.phone).filter(Boolean),
  });
}

async function sheetWhitelistForForm(
  formId: string
): Promise<RegistrationWhitelist | undefined> {
  if (!isSheetsApiConfigured()) return undefined;
  try {
    const rows = await getCachedSheetRows();
    return sheetWhitelistFromRows(rows, formId);
  } catch (err) {
    console.error("[whitelist] Failed to read Registration Whitelist sheet:", err);
    return undefined;
  }
}

/**
 * Env ∪ active sheet rows for a form. Undefined when the form is not opted in
 * or has no identities. Public whitelistCheck must only use this for matching.
 */
export async function registrationWhitelistForForm(
  formId: string
): Promise<RegistrationWhitelist | undefined> {
  const key = formId.trim();
  if (!key || !WHITELIST_REGISTRATION_FORM_IDS.has(key)) return undefined;
  return mergeWhitelists(
    envRegistrationWhitelistForForm(key),
    await sheetWhitelistForForm(key)
  );
}

function envEntriesForForm(formId: string): AdminWhitelistEntry[] {
  const env = envRegistrationWhitelistForForm(formId);
  if (!env) return [];
  const entries: AdminWhitelistEntry[] = [];
  for (const email of uniqueNormalized(env.emails ?? [], normalizeWhitelistEmail)) {
    entries.push({ source: "env", email, phone: "" });
  }
  for (const phone of uniqueNormalized(env.phones ?? [], normalizeWhitelistPhone)) {
    entries.push({ source: "env", email: "", phone });
  }
  return entries;
}

function sheetEntriesForForm(
  rows: SheetWhitelistRow[],
  formId: string
): AdminWhitelistEntry[] {
  return activeRowsForForm(rows, formId).map((row) => ({
    source: "sheet" as const,
    email: row.email,
    phone: row.phone,
    notes: row.notes || undefined,
    addedBy: row.addedBy || undefined,
    addedAt: row.addedAt || undefined,
    sheetRow: row.sheetRow,
  }));
}

export async function listRegistrationWhitelist(
  formId: string
): Promise<AdminWhitelistEntry[]> {
  const key = formId.trim();
  const envEntries = envEntriesForForm(key);
  if (!isSheetsApiConfigured()) return envEntries;
  try {
    const rows = await getCachedSheetRows();
    return [...envEntries, ...sheetEntriesForForm(rows, key)];
  } catch (err) {
    console.error("[whitelist] Failed to list Registration Whitelist sheet:", err);
    return envEntries;
  }
}

async function ensureWhitelistTab(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const tab = whitelistSheetTab();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tab);
  if (!exists) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("already exists")) throw err;
    }
  }
  const repo = createRepository(tab);
  await repo.ensureColumnMap([...WHITELIST_COLUMNS]);
}

function identityConflict(
  existing: RegistrationWhitelist | undefined,
  email: string,
  phone: string
): string | null {
  const emails = (existing?.emails ?? []).map(normalizeWhitelistEmail);
  const phones = (existing?.phones ?? []).map(normalizeWhitelistPhone);
  if (email && emails.includes(email)) {
    return "That email is already on this event's whitelist.";
  }
  if (phone && phones.includes(phone)) {
    return "That phone number is already on this event's whitelist.";
  }
  return null;
}

export function parseWhitelistIdentityInput(input: {
  email?: string;
  phone?: string;
  notes?: string;
}): { email: string; phone: string; notes: string } | { error: string; message: string } {
  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  const rawPhone = typeof input.phone === "string" ? input.phone.trim() : "";
  const rawNotes = typeof input.notes === "string" ? input.notes.trim() : "";

  if (!rawEmail && !rawPhone) {
    return {
      error: "missing_identity",
      message: "Enter an email address, a phone number, or both.",
    };
  }

  let email = "";
  if (rawEmail) {
    email = normalizeWhitelistEmail(rawEmail);
    if (!EMAIL_RE.test(email)) {
      return { error: "invalid_email", message: "Enter a valid email address." };
    }
  }

  let phone = "";
  if (rawPhone) {
    phone = normalizeWhitelistPhone(rawPhone);
    if (phone.length < 10) {
      return {
        error: "invalid_phone",
        message: "Enter a phone number with at least 10 digits.",
      };
    }
  }

  if (rawNotes.length > WHITELIST_NOTES_MAX) {
    return {
      error: "invalid_notes",
      message: `Notes must be ${WHITELIST_NOTES_MAX} characters or fewer.`,
    };
  }

  return { email, phone, notes: rawNotes };
}

export async function addRegistrationWhitelistEntry(input: {
  formId: string;
  email?: string;
  phone?: string;
  notes?: string;
  addedBy?: string;
}): Promise<AddResult> {
  const formId = input.formId.trim();
  const parsed = parseWhitelistIdentityInput(input);
  if ("error" in parsed) return { success: false, ...parsed };

  const merged = await registrationWhitelistForForm(formId);
  const conflict = identityConflict(merged, parsed.email, parsed.phone);
  if (conflict) {
    return { success: false, error: "duplicate", message: conflict };
  }

  const now = new Date();
  const addedBy = input.addedBy?.trim() || "admin";
  const addedAt = formatSheetDateTime(now);
  const tab = whitelistSheetTab();

  type LockResult =
    | { ok: true; sheetRow: number }
    | { ok: false; error: "duplicate"; message: string };

  const locked = await withSheetTabLock(getSpreadsheetId(), tab, async (): Promise<LockResult> => {
    await ensureWhitelistTab();
    const latest = await loadSheetRowsFromSpreadsheet();
    const latestMerged = mergeWhitelists(
      envRegistrationWhitelistForForm(formId),
      sheetWhitelistFromRows(latest, formId)
    );
    const lockedConflict = identityConflict(latestMerged, parsed.email, parsed.phone);
    if (lockedConflict) {
      return { ok: false, error: "duplicate", message: lockedConflict };
    }

    const repo = createRepository(tab);
    const { map } = await repo.ensureColumnMap([...WHITELIST_COLUMNS]);
    const sheetRow = await repo.appendRow(map, [
      { key: "Form ID", value: sanitizeCell(formId) },
      { key: "Email", value: sanitizeCell(parsed.email) },
      { key: "Phone", value: sanitizeCell(parsed.phone) },
      { key: "Notes", value: sanitizeCell(parsed.notes) },
      { key: "Added By", value: sanitizeCell(addedBy) },
      { key: "Added At", value: addedAt },
      { key: "Status", value: "Active" },
    ]);
    return { ok: true, sheetRow };
  });

  if (!locked.ok) {
    return { success: false, error: locked.error, message: locked.message };
  }

  await invalidateWhitelistCache();
  return {
    success: true,
    entry: {
      source: "sheet",
      email: parsed.email,
      phone: parsed.phone,
      notes: parsed.notes || undefined,
      addedBy,
      addedAt,
      sheetRow: locked.sheetRow || undefined,
    },
  };
}

export async function removeRegistrationWhitelistEntry(input: {
  formId: string;
  sheetRow: number;
}): Promise<RemoveResult> {
  const formId = input.formId.trim();
  const sheetRow = input.sheetRow;
  if (!Number.isInteger(sheetRow) || sheetRow < 2) {
    return { success: false, error: "not_found", message: "That whitelist row was not found." };
  }

  const tab = whitelistSheetTab();
  const result = await withSheetTabLock(getSpreadsheetId(), tab, async () => {
    const rows = await loadSheetRowsFromSpreadsheet();
    const row = rows.find((entry) => entry.sheetRow === sheetRow);
    if (!row || row.formId.trim() !== formId || !isActiveStatus(row.status)) {
      return { success: false as const, error: "not_found", message: "That whitelist row was not found." };
    }

    const repo = createRepository(tab);
    const { map } = await repo.ensureColumnMap([...WHITELIST_COLUMNS]);
    await repo.updateRowCells(sheetRow, map, [{ key: "Status", value: "Removed" }]);
    return { success: true as const, sheetRow };
  });

  if (result.success) await invalidateWhitelistCache();
  return result;
}
