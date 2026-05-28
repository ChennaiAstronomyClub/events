import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Tracks a payment hold expiry ISO timestamp with a live countdown.
 */
export function useHoldCountdown(expiresAt: string | null) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(null);
      setExpired(false);
      return;
    }

    function tick() {
      const ms = new Date(expiresAt as string).getTime() - Date.now();
      if (ms <= 0) {
        setRemainingMs(0);
        setExpired(true);
      } else {
        setRemainingMs(ms);
        setExpired(false);
      }
    }

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return {
    expired,
    remainingMs,
    formatted: remainingMs !== null ? formatRemaining(remainingMs) : null,
  };
}
