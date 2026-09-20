import { ExternalLink } from "lucide-react";

const CLUB_HOME_URL = "https://chennaiastronomyclub.org/";

const POLICY_LINKS = [
  { label: "Terms", href: "https://chennaiastronomyclub.org/terms" },
  { label: "Privacy", href: "https://chennaiastronomyclub.org/privacy" },
  { label: "Refunds", href: "https://chennaiastronomyclub.org/refunds" },
  { label: "Shipping", href: "https://chennaiastronomyclub.org/shipping" },
] as const;

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="border-t bg-background py-4">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-4 text-center text-sm">
        <a
          href={CLUB_HOME_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Chennai Astronomy Club
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {POLICY_LINKS.map((link) => (
            <FooterLink key={link.href} href={link.href}>
              {link.label}
            </FooterLink>
          ))}
        </nav>
      </div>
    </footer>
  );
}
