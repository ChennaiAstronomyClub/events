import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { GOOGLE_FORM_URL } from "@/lib/env";
import { LoginButton } from "./LoginButton";
import { storage } from "@/lib/storage";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    storage.setReturnTo(location.pathname);
    return (
      <div className="flex flex-col items-center gap-8 py-12">
        <div>
          <h2 className="text-lg font-semibold">Login Required</h2>
          <p className="mt-2 text-muted-foreground">
            Please log in with your community forum account to continue.
          </p>
          <div className="mt-4">
            <LoginButton />
          </div>
        </div>

        {GOOGLE_FORM_URL && (
          <>
            <div className="border-t w-full" />
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">
                Not part of the CAC Forum yet? We strongly recommend joining the forum first for updates and community access.
              </p>

              <a
                href="https://forum.chennaiastronomyclub.org/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium border border-input rounded-md hover:bg-accent hover:text-accent-foreground mb-4" 
              >
                Join Our Forum
              </a>
              {/* <a
                href={GOOGLE_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium border border-input rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Continue with Google Forms only if you do not want to join the forum
              </a> */}
            </div>
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
