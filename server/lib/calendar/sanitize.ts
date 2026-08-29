import { escapeHtml, htmlHasText, INVITE_BODY_MAX } from "../../../src/lib/calendar/email.js";

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
]);

function hrefFromAttrs(attrs: string): string | null {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? match[3] ?? "";
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const trimmed = decoded.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/[\s<>]/.test(trimmed)) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) return null;
  if (/javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Allowlist sanitizer for invite HTML. Kept dependency-free so the Vercel
 * function does not load sanitize-html (that package crashes this serverless
 * bundle on import).
 */
export function sanitizeInviteHtml(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  let pendingSpanCloses = 0;
  const cleaned = withoutComments.replace(
    /<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_full, closingSlash: string | undefined, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      const isClose = Boolean(closingSlash);

      if (name === "br") return isClose ? "" : "<br />";

      if (name === "a") {
        if (isClose) {
          if (pendingSpanCloses > 0) {
            pendingSpanCloses -= 1;
            return "</span>";
          }
          return "</a>";
        }
        const href = hrefFromAttrs(rawAttrs ?? "");
        if (!href) {
          pendingSpanCloses += 1;
          return "<span>";
        }
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
      }

      return isClose ? `</${name}>` : `<${name}>`;
    }
  );
  return cleaned.trim().slice(0, INVITE_BODY_MAX);
}

export function sanitizeInviteHtmlOrEmpty(html: string): string | undefined {
  const cleaned = sanitizeInviteHtml(html);
  if (!htmlHasText(cleaned)) return undefined;
  return cleaned;
}
