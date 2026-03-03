import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { storage } from "@/lib/storage";

/**
 * Validates a returnTo path to prevent open-redirect attacks.
 * Only relative paths starting with "/" are allowed.
 */
function safeReturnTo(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const { handleCallback, isAuthenticated, error } = useAuth();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;

    // Extract payload from raw URL — we can't use URLSearchParams.get() because
    // Discourse CGI.escape encodes the base64 payload with "+" chars which
    // URLSearchParams would silently decode as spaces, corrupting the ciphertext.
    const rawSearch = window.location.search || window.location.hash?.replace("#", "?");
    const match = rawSearch?.match(/[?&]payload=([^&]+)/);
    let payload: string | null = null;

    if (match) {
      payload = decodeURIComponent(match[1]);
    } else {
      payload = searchParams.get("payload");
    }

    if (payload) {
      const privateKeyPem = storage.getPrivateKey();
      if (!privateKeyPem) {
        console.warn("[auth] No private key found — session may have expired");
        return;
      }

      processedRef.current = true;
      handleCallback(payload, privateKeyPem);
    } else {
      console.warn("[auth] No payload found in callback URL");
    }
  }, [searchParams, handleCallback]);

  useEffect(() => {
    if (isAuthenticated) {
      const returnTo = safeReturnTo(storage.getReturnTo());
      storage.clearReturnTo();
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <h2 className="text-lg font-semibold text-destructive">Authentication Failed</h2>
        <p className="text-muted-foreground">{error}</p>
        <a href="/" className="text-primary underline">
          Return home
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-muted-foreground">Completing login...</p>
    </div>
  );
}
