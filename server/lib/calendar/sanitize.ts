import sanitizeHtml from "sanitize-html";
import { htmlHasText, INVITE_BODY_MAX } from "../../src/lib/calendar/email.js";

const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li"];

export function sanitizeInviteHtml(html: string): string {
  const cleaned = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs) => {
        const href = attribs.href ?? "";
        if (!href) return { tagName: "span", attribs: {} };
        return {
          tagName: "a",
          attribs: {
            href,
            target: "_blank",
            rel: "noopener noreferrer",
          },
        };
      },
    },
  }).trim();
  return cleaned.slice(0, INVITE_BODY_MAX);
}

export function sanitizeInviteHtmlOrEmpty(html: string): string | undefined {
  const cleaned = sanitizeInviteHtml(html);
  if (!htmlHasText(cleaned)) return undefined;
  return cleaned;
}
