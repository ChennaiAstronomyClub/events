import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNotices } from "@/hooks/useNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const DISMISSED_KEY = "cac_dismissed_notices";

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persistDismiss(id: string) {
  const current = getDismissed();
  localStorage.setItem(
    DISMISSED_KEY,
    JSON.stringify([...new Set([...current, id])])
  );
}

/**
 * Fetches and renders server-filtered notices for the given form.
 * Each notice is targeted server-side (group, username, trust level, time window)
 * so no sensitive targeting info is ever in the client bundle.
 * Dismissible notices store their dismissed state in localStorage.
 */
export function NoticeAlert({ formId }: { formId: string }) {
  const { isAuthenticated } = useAuth();
  const notices = useNotices(formId, isAuthenticated);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed);

  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (!visible.length) return null;

  function handleDismiss(id: string) {
    persistDismiss(id);
    setDismissed(getDismissed());
  }

  return (
    <div className="space-y-2">
      {visible.map((notice) => (
        <Alert
          key={notice.id}
          variant={notice.type === "warning" ? "destructive" : "default"}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {notice.title && <AlertTitle>{notice.title}</AlertTitle>}
              <AlertDescription>
                {notice.message}
                {notice.linkUrl && (
                  <a
                    href={notice.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 underline"
                  >
                    {notice.linkLabel ?? "Learn more"}
                  </a>
                )}
              </AlertDescription>
            </div>
            {notice.dismissible && (
              <button
                onClick={() => handleDismiss(notice.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss notice"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </Alert>
      ))}
    </div>
  );
}
