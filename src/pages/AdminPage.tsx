import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { storage } from "@/lib/storage";
import { getListedFormConfigs } from "@/config/forms";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SendResult = { status: "idle" | "sending" | "success" | "error"; message: string };

async function sendNoticeEmails(
  formId: string,
  onResult: (result: SendResult) => void
) {
  const apiKey = storage.getApiKey();
  if (!apiKey) {
    onResult({ status: "error", message: "Not logged in" });
    return;
  }

  onResult({ status: "sending", message: "Sending…" });
  try {
    const res = await fetch("/api/send-notice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Api-Key": apiKey,
      },
      body: JSON.stringify({ formId }),
    });
    const data = await res.json();
    if (res.ok) {
      onResult({
        status: "success",
        message: `Sent to ${data.sent} recipient${data.sent !== 1 ? "s" : ""}${data.failed ? ` (${data.failed} failed)` : ""}`,
      });
    } else {
      onResult({ status: "error", message: data.error ?? "Unknown error" });
    }
  } catch {
    onResult({ status: "error", message: "Network error" });
  }
}

/**
 * Admin page for sending notice email notifications to group members.
 * Access requires the logged-in Discourse account to have admin: true.
 * Admin status is verified server-side — this client check is just UX.
 */
export function AdminPage() {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [results, setResults] = useState<Record<string, SendResult>>({});

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

  function handleSend(formId: string) {
    sendNoticeEmails(formId, (result) =>
      setResults((prev) => ({ ...prev, [formId]: result }))
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin — Send Notifications</h1>
        <p className="text-muted-foreground mt-1">
          Send email notifications to registered group members for each event.
          Recipients are fetched from Discourse based on the notice targeting
          configured in Vercel environment variables.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {getListedFormConfigs().map((form) => {
          const result = results[form.id];
          return (
            <Card key={form.id}>
              <CardHeader>
                <CardTitle className="text-base">{form.title}</CardTitle>
                <CardDescription>Form ID: {form.id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => handleSend(form.id)}
                  disabled={result?.status === "sending"}
                  className="w-full"
                >
                  {result?.status === "sending"
                    ? "Sending…"
                    : "Send Email Notification"}
                </Button>
                {result && result.status !== "idle" && (
                  <p
                    className={
                      result.status === "success"
                        ? "text-sm text-green-700"
                        : "text-sm text-destructive"
                    }
                  >
                    {result.message}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
