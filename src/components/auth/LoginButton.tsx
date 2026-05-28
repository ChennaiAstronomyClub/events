import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function LoginButton() {
  const { login, isLoading } = useAuth();

  return (
    <Button onClick={login} size="sm" disabled={isLoading}>
      {isLoading ? "Redirecting..." : "Login with CAC Forum"}
    </Button>
  );
}
