import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/auth/LoginButton";
import { Button } from "@/components/ui/button";

export function Header() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-2 px-4">
        <Link to="/" className="flex min-w-0 shrink items-end gap-2">
          <img
            src="https://forum.chennaiastronomyclub.org/uploads/default/original/2X/f/f8c566ac2c591ec2a4c89981ca144d0b3770b01a.png"
            alt="Chennai Astronomy Club"
            className="h-8 shrink-0 object-contain"
          />
          <span className="truncate text-lg font-semibold leading-none">Events</span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
          {isAuthenticated && user?.admin ? (
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3">
              <Link to="/admin">Admin</Link>
            </Button>
          ) : null}
          {isAuthenticated && user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {user.name || user.username}
              </span>
              <Button variant="outline" size="sm" onClick={logout}>
                Logout
              </Button>
            </>
          ) : (
            <LoginButton />
          )}
        </div>
      </div>
    </header>
  );
}
