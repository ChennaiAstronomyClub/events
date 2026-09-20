import { storage } from "@/lib/storage";
import type { WhitelistInviteIdentity } from "@/lib/whitelist-invite";

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

interface WhitelistListResponse {
  success: boolean;
  formId?: string;
  entries?: AdminWhitelistEntry[];
  error?: string;
  message?: string;
}

interface WhitelistAddResponse {
  success: boolean;
  formId?: string;
  entry?: AdminWhitelistEntry;
  error?: string;
  message?: string;
}

interface WhitelistRemoveResponse {
  success: boolean;
  formId?: string;
  sheetRow?: number;
  error?: string;
  message?: string;
}

function whitelistHeaders(): HeadersInit {
  const apiKey = storage.getApiKey();
  if (!apiKey) throw new Error("Not logged in");
  return {
    "Content-Type": "application/json",
    "User-Api-Key": apiKey,
  };
}

export async function fetchRegistrationWhitelist(
  formId: string
): Promise<WhitelistListResponse> {
  const res = await fetch("/api/registration-whitelist", {
    method: "POST",
    headers: whitelistHeaders(),
    body: JSON.stringify({ action: "list", formId }),
  });
  return res.json() as Promise<WhitelistListResponse>;
}

export async function addRegistrationWhitelistEntry(
  formId: string,
  identity: WhitelistInviteIdentity & { notes?: string }
): Promise<WhitelistAddResponse> {
  const res = await fetch("/api/registration-whitelist", {
    method: "POST",
    headers: whitelistHeaders(),
    body: JSON.stringify({
      action: "add",
      formId,
      email: identity.email ?? undefined,
      phone: identity.phone ?? undefined,
      notes: identity.notes,
    }),
  });
  return res.json() as Promise<WhitelistAddResponse>;
}

export async function removeRegistrationWhitelistEntry(
  formId: string,
  sheetRow: number
): Promise<WhitelistRemoveResponse> {
  const res = await fetch("/api/registration-whitelist", {
    method: "POST",
    headers: whitelistHeaders(),
    body: JSON.stringify({ action: "remove", formId, sheetRow }),
  });
  return res.json() as Promise<WhitelistRemoveResponse>;
}

export function whitelistIdentityLabel(entry: AdminWhitelistEntry): string {
  const parts = [entry.email.trim(), entry.phone.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
