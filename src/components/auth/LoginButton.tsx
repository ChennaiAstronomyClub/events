import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function LoginButton({
  className,
  style,
  label = "Login with CAC Forum",
  unstyled = false,
}: {
  className?: string;
  style?: CSSProperties;
  label?: string;
  unstyled?: boolean;
}) {
  const { login } = useAuth();
  const [pending, setPending] = useState(false);
  const text = pending ? "Redirecting..." : label;

  function onClick() {
    setPending(true);
    login();
  }

  if (unstyled) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={cn(className)}
        style={style}
      >
        {text}
      </button>
    );
  }

  return (
    <Button onClick={onClick} size="sm" disabled={pending} className={className}>
      {text}
    </Button>
  );
}
