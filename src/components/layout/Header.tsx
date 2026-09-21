import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { LoginButton } from "@/components/auth/LoginButton";
import { useAuth } from "@/hooks/useAuth";
import { ensureCacChrome } from "@/lib/cac-chrome";

function AuthButton({ slot }: { slot: string }) {
  const { isAuthenticated, user, logout } = useAuth();

  if (isAuthenticated && user) {
    return (
      <button type="button" slot={slot} data-cac="join" onClick={logout}>
        Logout
      </button>
    );
  }

  return <LoginButton unstyled slot={slot} data-cac="join" label="Login" />;
}

export function Header() {
  const { user } = useAuth();
  const location = useLocation();
  const onAdmin = location.pathname.startsWith("/admin");

  useEffect(() => {
    void ensureCacChrome();
  }, []);

  return (
    <cac-header active={onAdmin ? "admin" : "events"} hide-join="" events-href="/">
      {user?.admin ? (
        <Link
          slot="nav-end"
          to="/admin"
          aria-current={onAdmin ? "page" : undefined}
        >
          Admin
        </Link>
      ) : null}
      <AuthButton slot="actions" />
      <AuthButton slot="mobile-actions" />
    </cac-header>
  );
}
