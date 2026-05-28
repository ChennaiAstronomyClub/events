/** Prevent parallel reserve calls for the same form + email (e.g. React Strict Mode). */
const RESERVE_IN_FLIGHT = new Map<string, Promise<unknown>>();

function reserveKey(formId: string, email: string): string {
  return `${formId}::${email.toLowerCase()}`;
}

export function withReserveDedupe<T>(
  formId: string,
  email: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = reserveKey(formId, email);
  const existing = RESERVE_IN_FLIGHT.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    if (RESERVE_IN_FLIGHT.get(key) === promise) {
      RESERVE_IN_FLIGHT.delete(key);
    }
  });
  RESERVE_IN_FLIGHT.set(key, promise);
  return promise;
}
