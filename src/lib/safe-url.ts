/** Allow only http(s) and mailto for user-/ops-provided hrefs. */
export function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}
