import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClubLogo } from "./ClubLogo";
import { legalPages, site, siteHref } from "@/config/site";

const svgProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeJoin: "round" as const,
  "aria-hidden": true,
};

const footerExploreColumns = [
  [
    { label: "About", href: "/about" },
    { label: "Join Us", href: "/join" },
    { label: "Events", href: "/events" },
    { label: "Forum", href: site.forumUrl, external: true },
    { label: "FAQ", href: "/faq" },
    { label: "Contact Us", href: "/contact" },
  ],
  [
    { label: "Blog", href: "/blogs" },
    { label: "Outreach", href: "/outreach" },
    { label: "Night Sky Passport", href: "/night-sky-passport" },
    { label: "Podcast", href: site.podcastPath },
    { label: "Press", href: "/press" },
  ],
] as const;

function NavIcon({ children }: { children: ReactNode }) {
  return <svg {...svgProps}>{children}</svg>;
}

function ExploreIcon({ label, href }: { label: string; href: string }) {
  if (label === "About") {
    return (
      <NavIcon>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </NavIcon>
    );
  }
  if (label === "Join Us") {
    return (
      <NavIcon>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </NavIcon>
    );
  }
  if (label === "Events") {
    return (
      <NavIcon>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M3 10h18" />
        <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      </NavIcon>
    );
  }
  if (label === "Forum") {
    return (
      <NavIcon>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </NavIcon>
    );
  }
  if (label === "Blog") {
    return (
      <NavIcon>
        <path d="M12 20h9" />
        <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
      </NavIcon>
    );
  }
  if (label === "Outreach") {
    return (
      <NavIcon>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </NavIcon>
    );
  }
  if (href === "/night-sky-passport") {
    return (
      <NavIcon>
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        <circle cx="15" cy="13" r="2.25" />
      </NavIcon>
    );
  }
  if (label === "FAQ") {
    return (
      <NavIcon>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </NavIcon>
    );
  }
  if (label === "Podcast") {
    return (
      <NavIcon>
        <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
      </NavIcon>
    );
  }
  if (label === "Press") {
    return (
      <NavIcon>
        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
        <path d="M18 14h-8" />
        <path d="M15 18h-5" />
        <path d="M10 6h8v4h-8V6Z" />
      </NavIcon>
    );
  }
  if (label === "Contact Us") {
    return (
      <NavIcon>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 7l10 7 10-7" />
      </NavIcon>
    );
  }
  return null;
}

function ExploreLink({
  label,
  href,
  external,
}: {
  label: string;
  href: string;
  external?: boolean;
}) {
  const to = siteHref(href, external);
  const content = (
    <>
      <ExploreIcon label={label} href={href} />
      {label}
    </>
  );

  if (href === "/events") {
    return (
      <Link to={to} className="footer-nav-link">
        {content}
      </Link>
    );
  }

  return (
    <a
      href={to}
      className="footer-nav-link"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {content}
    </a>
  );
}

/** Port of the club website `src/components/layout/Footer.astro`. */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer mt-16">
      <div className="footer-content">
        <div className="page-container">
          <div className="footer-top-grid">
            <div className="footer-brand">
              <a href={site.url} className="footer-brand-logo-link" aria-label="Chennai Astronomy Club home">
                <ClubLogo height={40} />
              </a>
              <h2 className="footer-brand-title">{site.name}</h2>
              <div className="footer-brand-description">
                {site.footerDescription.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <p className="footer-brand-tagline">
                <span aria-hidden="true">—</span>
                <em>{site.tagline}.</em>
              </p>
            </div>

            <div className="footer-nav-col">
              <h3 className="footer-section-heading">Explore</h3>
              <nav className="footer-nav" aria-label="Footer navigation">
                {footerExploreColumns.map((column) => (
                  <div key={column[0].label} className="footer-nav-column">
                    {column.map((item) => (
                      <ExploreLink
                        key={item.label}
                        label={item.label}
                        href={item.href}
                        external={"external" in item && item.external}
                      />
                    ))}
                  </div>
                ))}
              </nav>
            </div>

            <div className="footer-cta">
              <div className="footer-cta-box">
                <h3 className="footer-cta-heading">Join the Community</h3>
                <p className="footer-cta-text">
                  Curious about the night sky? You're welcome here. Joining is free, and you don't
                  need a telescope or any experience.
                </p>
                <a href={`${site.url}/join`} className="btn-primary footer-cta-btn">
                  How to Join →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-meta-band">
        <div className="page-container footer-meta">
          <span className="footer-meta-copy">
            © {year} {site.name}
          </span>
          <span className="footer-meta-status">
            Volunteer-run • Non-profit • Since {site.established}
          </span>
          <nav className="footer-meta-nav" aria-label="Social and contact">
            <a
              href={site.social.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-social-icon"
              aria-label="Instagram (opens in new tab)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
            </a>
            <a
              href={site.social.youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-social-icon"
              aria-label="YouTube (opens in new tab)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
                <path d="m10 15 5-3-5-3z" />
              </svg>
            </a>
            <a href={`mailto:${site.email}`} className="footer-social-icon" aria-label="Email">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 7l10 7 10-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </nav>
          <nav className="footer-legal-nav" aria-label="Legal">
            {legalPages.map((page) => (
              <a key={page.href} href={siteHref(page.href)} className="footer-legal-link">
                {page.shortLabel}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
