const forumUrl = "https://forum.chennaiastronomyclub.org";

/** Identity copied from the club website `src/config/site.ts`. */
export const site = {
  name: "Chennai Astronomy Club",
  tagline: "We Are Stardust",
  footerDescription: [
    "A volunteer-run astronomy community in Chennai.",
    "Stargazing events, star parties, workshops, and outreach.",
    "Free to join. Beginner-friendly.",
  ],
  url: "https://chennaiastronomyclub.org",
  forumUrl,
  established: 2013,
  email: "hello@chennaiastronomyclub.org",
  social: {
    instagram: "https://www.instagram.com/chennaiastronomyclub/",
    youtube: "https://www.youtube.com/@chennaiastronomyclub",
  },
  podcastPath: "/dark-enough",
  nav: [
    { label: "About", href: "/about" },
    { label: "Outreach", href: "/outreach" },
    { label: "Events", href: "/events" },
    { label: "Forum", href: forumUrl, external: true },
    { label: "Blog", href: "/blogs" },
  ],
} as const;

export const legalPages = [
  { shortLabel: "Terms", href: "/terms" },
  { shortLabel: "Privacy", href: "/privacy" },
  { shortLabel: "Refunds", href: "/refunds" },
  { shortLabel: "Shipping", href: "/shipping" },
] as const;

export type NavItem = (typeof site.nav)[number];

export function isEventsItem(item: { href: string }) {
  return item.href === "/events";
}

export function siteHref(href: string, external?: boolean) {
  if (external || href.startsWith("http")) return href;
  if (href === "/events") return "/";
  return `${site.url}${href}`;
}

export function navHref(item: NavItem) {
  return siteHref(item.href, "external" in item && item.external);
}
