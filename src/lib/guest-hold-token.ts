const HOLD_TOKEN_PREFIX = "cac_hold_token_";

export function setHoldToken(formId: string, token: string): void {
  sessionStorage.setItem(`${HOLD_TOKEN_PREFIX}${formId}`, token);
}

export function getHoldToken(formId: string): string | null {
  return sessionStorage.getItem(`${HOLD_TOKEN_PREFIX}${formId}`);
}

export function clearHoldToken(formId: string): void {
  sessionStorage.removeItem(`${HOLD_TOKEN_PREFIX}${formId}`);
}
