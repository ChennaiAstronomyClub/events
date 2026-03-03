/**
 * RSA key generation and payload decryption for Discourse User API Key auth.
 *
 * Uses node-forge because Discourse (pre-Dec 2025) encrypts with PKCS1v1.5
 * padding by default, which the Web Crypto API does NOT support for decryption.
 * node-forge handles both PKCS1v1.5 and OAEP.
 */

import forge from "node-forge";
import type { DiscourseAuthPayload } from "@/types/discourse";

const KEY_BITS = 2048;

export interface ForgeKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Generate an RSA-2048 key pair for the Discourse auth handshake. */
export function generateKeyPair(): ForgeKeyPair {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: KEY_BITS, e: 0x10001 });
  return {
    publicKeyPem: forge.pki.publicKeyToPem(keypair.publicKey),
    privateKeyPem: forge.pki.privateKeyToPem(keypair.privateKey),
  };
}

/**
 * Decrypt the encrypted payload Discourse sends back after authorization.
 *
 * Tries OAEP (SHA-1), OAEP (SHA-256), then PKCS1v1.5 to cover all
 * Discourse deployment configurations.
 */
export function decryptPayload(
  encryptedBase64: string,
  privateKeyPem: string
): DiscourseAuthPayload {
  // Normalize base64 (URL-safe → standard, add padding)
  let normalized = encryptedBase64.replace(/[\s\r\n]+/g, "");
  normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }

  const encrypted = forge.util.decode64(normalized);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const strategies: Array<{ label: string; run: () => string }> = [
    {
      label: "RSA-OAEP (SHA-1)",
      run: () => privateKey.decrypt(encrypted, "RSA-OAEP"),
    },
    {
      label: "RSA-OAEP (SHA-256)",
      run: () =>
        privateKey.decrypt(encrypted, "RSA-OAEP", {
          md: forge.md.sha256.create(),
        }),
    },
    {
      label: "RSAES-PKCS1-V1_5",
      run: () => privateKey.decrypt(encrypted, "RSAES-PKCS1-V1_5"),
    },
  ];

  let decrypted: string | null = null;
  let lastError: unknown = null;

  for (const strategy of strategies) {
    try {
      decrypted = strategy.run();
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!decrypted) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to decrypt auth payload");
  }

  // Parse and validate the decrypted JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new Error("Decrypted payload is not valid JSON");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).key !== "string" ||
    typeof (parsed as Record<string, unknown>).nonce !== "string"
  ) {
    throw new Error("Decrypted payload missing required fields (key, nonce)");
  }

  return parsed as DiscourseAuthPayload;
}

/** Generate a cryptographically random 128-bit hex nonce. */
export function generateNonce(): string {
  const bytes = forge.random.getBytesSync(16);
  return forge.util.bytesToHex(bytes);
}

/** Generate a unique client ID for the Discourse auth request. */
export function generateClientId(): string {
  return `cac-forms-${crypto.randomUUID()}`;
}
