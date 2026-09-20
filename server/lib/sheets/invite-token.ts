import { randomBytes } from "crypto";

/** Cryptographically random opaque invite token (unique per whitelist entry). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface InviteTokenClaims {
  formId: string;
  email?: string;
  phone?: string;
  sheetRow?: number;
  source: "sheet" | "env";
}
