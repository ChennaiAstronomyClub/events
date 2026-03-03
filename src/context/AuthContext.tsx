import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import type { AuthState } from "@/types/auth";
import type { DiscourseUser } from "@/types/discourse";
import { decryptPayload } from "@/lib/crypto-utils";
import { fetchFullUser } from "@/lib/discourse-api";
import { initiateLogin } from "@/lib/discourse-auth";
import { storage } from "@/lib/storage";

interface AuthContextValue extends AuthState {
  login: () => void;
  logout: () => void;
  handleCallback: (payload: string, privateKeyPem: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    apiKey: null,
    error: null,
  });

  // Restore session on mount
  useEffect(() => {
    const apiKey = storage.getApiKey();
    if (!apiKey) {
      storage.clearUser(); // Clean up stale user data from localStorage
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }

    fetchFullUser(apiKey)
      .then((user) => {
        storage.setUser(user);
        setState({
          isAuthenticated: true,
          isLoading: false,
          user,
          apiKey,
          error: null,
        });
      })
      .catch(() => {
        // API key expired or invalid
        storage.clearAll();
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          apiKey: null,
          error: null,
        });
      });
  }, []);

  const login = useCallback(() => {
    try {
      initiateLogin();
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Login failed",
      }));
    }
  }, []);

  const logout = useCallback(() => {
    storage.clearAll();
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      apiKey: null,
      error: null,
    });
  }, []);

  const handleCallback = useCallback(async (payload: string, privateKeyPem: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      if (!privateKeyPem) {
        throw new Error("No private key found. Please try logging in again.");
      }

      const decrypted = decryptPayload(payload, privateKeyPem);

      const storedNonce = storage.getNonce();
      if (storedNonce && decrypted.nonce !== storedNonce) {
        throw new Error("Nonce mismatch. Please try logging in again.");
      }

      // Store API key and clean up auth artifacts
      storage.setApiKey(decrypted.key);
      storage.clearPrivateKey();
      storage.clearNonce();

      // Fetch user profile
      const user: DiscourseUser = await fetchFullUser(decrypted.key);
      storage.setUser(user);

      setState({
        isAuthenticated: true,
        isLoading: false,
        user,
        apiKey: decrypted.key,
        error: null,
      });
    } catch (err) {
      console.error("[auth] Callback error:", err);
      storage.clearApiKey();
      storage.clearUser();
      storage.clearPrivateKey();
      storage.clearNonce();
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        apiKey: null,
        error: err instanceof Error ? err.message : "Authentication failed",
      });
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const apiKey = storage.getApiKey();
    if (!apiKey) return;
    try {
      const user = await fetchFullUser(apiKey);
      storage.setUser(user);
      setState((s) => ({ ...s, user }));
    } catch {
      // Silently fail — user data stays as-is
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, handleCallback, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
