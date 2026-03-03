const KEYS = {
  privateKey: "cac_private_key_pem",
  nonce: "cac_auth_nonce",
  clientId: "cac_client_id",
  apiKey: "cac_discourse_api_key",
  user: "cac_discourse_user",
  returnTo: "cac_return_to",
} as const;

export const storage = {
  setPrivateKey(pem: string) {
    sessionStorage.setItem(KEYS.privateKey, pem);
  },
  getPrivateKey(): string | null {
    return sessionStorage.getItem(KEYS.privateKey);
  },
  clearPrivateKey() {
    sessionStorage.removeItem(KEYS.privateKey);
  },

  setNonce(nonce: string) {
    sessionStorage.setItem(KEYS.nonce, nonce);
  },
  getNonce(): string | null {
    return sessionStorage.getItem(KEYS.nonce);
  },
  clearNonce() {
    sessionStorage.removeItem(KEYS.nonce);
  },

  setClientId(clientId: string) {
    localStorage.setItem(KEYS.clientId, clientId);
  },
  getClientId(): string | null {
    return localStorage.getItem(KEYS.clientId);
  },

  setApiKey(key: string) {
    sessionStorage.setItem(KEYS.apiKey, key);
  },
  getApiKey(): string | null {
    return sessionStorage.getItem(KEYS.apiKey);
  },
  clearApiKey() {
    sessionStorage.removeItem(KEYS.apiKey);
  },

  setUser(user: unknown) {
    localStorage.setItem(KEYS.user, JSON.stringify(user));
  },
  getUser<T>(): T | null {
    const raw = localStorage.getItem(KEYS.user);
    return raw ? JSON.parse(raw) : null;
  },
  clearUser() {
    localStorage.removeItem(KEYS.user);
  },

  setReturnTo(path: string) {
    sessionStorage.setItem(KEYS.returnTo, path);
  },
  getReturnTo(): string | null {
    return sessionStorage.getItem(KEYS.returnTo);
  },
  clearReturnTo() {
    sessionStorage.removeItem(KEYS.returnTo);
  },

  clearAll() {
    Object.values(KEYS).forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  },

  // ---- Form submission tracking ----
  markFormSubmitted(formId: string, email: string) {
    localStorage.setItem(
      `cac_submitted_${formId}`,
      JSON.stringify({ email, submittedAt: new Date().toISOString() })
    );
  },

  getFormSubmission(
    formId: string
  ): { email: string; submittedAt: string } | null {
    const raw = localStorage.getItem(`cac_submitted_${formId}`);
    return raw ? JSON.parse(raw) : null;
  },

  clearFormSubmission(formId: string) {
    localStorage.removeItem(`cac_submitted_${formId}`);
  },
};
