import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/auth/LoginButton";
import { isEventsItem, navHref, site } from "@/config/site";
import { ClubLogo } from "./ClubLogo";

const navLinkClass =
  "text-left text-sm font-medium tracking-wide uppercase whitespace-nowrap border-0 bg-transparent p-0 shadow-none transition-colors hover:text-[var(--color-nav-text-active)] disabled:opacity-50";

function navStyle(active: boolean) {
  return {
    color: active
      ? "var(--color-nav-text-active)"
      : "var(--color-nav-text)",
  };
}

function NavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const location = useLocation();

  return (
    <>
      {site.nav.map((item) => {
        const href = navHref(item);
        const active = isEventsItem(item) && !location.pathname.startsWith("/admin");
        const classes = [navLinkClass, className].filter(Boolean).join(" ");
        const style = navStyle(active);
        const external = "external" in item && item.external;

        if (active) {
          return (
            <Link
              key={item.label}
              to={href}
              className={classes}
              style={style}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          );
        }

        return (
          <a
            key={item.label}
            href={href}
            className={classes}
            style={style}
            onClick={onNavigate}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {item.label}
          </a>
        );
      })}
      <AdminNavLink onNavigate={onNavigate} className={className} />
    </>
  );
}

function AdminNavLink({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user?.admin) return null;

  const classes = [navLinkClass, className].filter(Boolean).join(" ");
  const active = location.pathname.startsWith("/admin");

  return (
    <Link to="/admin" className={classes} style={navStyle(active)} onClick={onNavigate}>
      Admin
    </Link>
  );
}

function AuthControls({ className }: { className?: string }) {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div className={["items-center gap-3", className].filter(Boolean).join(" ")}>
      {isAuthenticated && user ? (
        <button type="button" className="btn-primary header-join-btn" onClick={logout}>
          Logout
        </button>
      ) : (
        <LoginButton unstyled className="btn-primary header-join-btn" label="Login" />
      )}
    </div>
  );
}

/** Port of the club website `src/components/layout/Header.astro`. */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header
      className="site-header sticky top-0 z-[200] border-b backdrop-blur-md"
      style={{
        backgroundColor: "var(--color-nav-backdrop)",
        borderColor: "var(--color-nav-border)",
      }}
    >
      <div className="page-container flex h-16 items-center justify-between gap-6">
        <a href={site.url} className="group flex shrink-0 items-center gap-3">
          <ClubLogo tone="white" height={36} className="shrink-0" />
          <div className="hidden sm:block">
            <div
              className="text-xs font-semibold tracking-widest uppercase"
              style={{
                color: "var(--color-nav-title)",
                fontFamily: "var(--font-display)",
              }}
            >
              {site.name}
            </div>
            <div className="text-caption" style={{ color: "var(--color-nav-caption)" }}>
              Est. {site.established}
            </div>
          </div>
        </a>

        <nav className="hidden items-center gap-4 lg:flex xl:gap-6" aria-label="Main navigation">
          <NavLinks />
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <AuthControls className="hidden sm:inline-flex" />
          <button
            type="button"
            className="btn-ghost !h-9 !px-3 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
              <rect y="2" width="18" height="2" rx="1" />
              <rect y="8" width="18" height="2" rx="1" />
              <rect y="14" width="18" height="2" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      <nav
        id="mobile-menu"
        className={menuOpen ? "border-t lg:hidden" : "hidden border-t lg:hidden"}
        style={{
          borderColor: "var(--color-nav-border)",
          backgroundColor: "var(--color-nav-surface)",
        }}
        aria-label="Mobile navigation"
      >
        <div className="page-container flex flex-col gap-3 py-4">
          <NavLinks
            onNavigate={() => setMenuOpen(false)}
            className="py-1"
          />
          <AuthControls className="mt-2 inline-flex w-fit sm:hidden" />
        </div>
      </nav>
    </header>
  );
}
