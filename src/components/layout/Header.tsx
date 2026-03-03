import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/auth/LoginButton";
import { Button } from "@/components/ui/button";

export function Header() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
        <Link to="/" className="flex items-end gap-2">
          <img
            src="https://forum.chennaiastronomyclub.org/uploads/default/original/1X/335c1fe4176468c35ab5f2086d70bc2ff700a7a2.png"
            alt="Chennai Astronomy Club"
            className="h-8 object-contain"
          />
          <span className="text-lg font-semibold leading-none">Events</span>
        </Link>

        <div className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <>
              <span className="text-sm text-muted-foreground">
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
