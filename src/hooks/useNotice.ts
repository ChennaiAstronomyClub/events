import { useState, useEffect } from "react";
import { storage } from "@/lib/storage";

export interface Notice {
  id: string;
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  type?: "info" | "warning" | "success";
  dismissible?: boolean;
}

/**
 * Fetches targeted notices for the given form from /api/notice.
 * Returns an empty array when the user is not authenticated or when no
 * notices are configured / applicable for this user.
 */
export function useNotices(formId: string, isAuthenticated: boolean): Notice[] {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const apiKey = storage.getApiKey();
    if (!apiKey) return;

    fetch(`/api/notice?formId=${encodeURIComponent(formId)}`, {
      headers: { "User-Api-Key": apiKey },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setNotices(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [formId, isAuthenticated]);

  return notices;
}
