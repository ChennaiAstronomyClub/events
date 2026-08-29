import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

/**
 * Requires a logged-in Discourse account with admin: true.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Please log in to continue.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    );
  }

  if (!user?.admin) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-lg font-semibold">Access Denied</h2>
        <p className="text-muted-foreground mt-1">
          This page requires a Discourse admin account.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    );
  }

  return children;
}
