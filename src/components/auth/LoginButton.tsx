import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function LoginButton() {
  const { login } = useAuth();

  return (
    <Button onClick={login} size="sm">
      Login with CAC Forum
    </Button>
  );
}
