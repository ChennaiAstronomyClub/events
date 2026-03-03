import {
  generateKeyPair,
  generateNonce,
  generateClientId,
} from "./crypto-utils";
import { DISCOURSE_URL, APP_URL, APP_NAME } from "./env";
import { storage } from "./storage";

export function buildAuthUrl(
  publicKeyPem: string,
  clientId: string,
  nonce: string
): string {
  const params = new URLSearchParams({
    application_name: APP_NAME,
    client_id: clientId,
    // Minimal required scopes:
    // - read: to fetch user profile (name, email) and custom user fields (phone, age, blood group, emergency contact)
    // - write: to update custom user fields when user opts to save changes to profile
    scopes: "read,write",
    public_key: publicKeyPem,
    auth_redirect: `${APP_URL}/auth/callback`,
    nonce,
    padding: "oaep",
  });

  return `${DISCOURSE_URL}/user-api-key/new?${params.toString()}`;
}

export function initiateLogin(): void {
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const nonce = generateNonce();
  const clientId = generateClientId();

  storage.setPrivateKey(privateKeyPem);
  storage.setNonce(nonce);
  storage.setClientId(clientId);

  const authUrl = buildAuthUrl(publicKeyPem, clientId, nonce);
  window.location.href = authUrl;
}
