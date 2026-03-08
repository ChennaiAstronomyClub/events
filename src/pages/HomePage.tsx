import { Link, useLocation } from "react-router-dom";
import { formConfigs, getRegistrationStatus } from "@/config/forms";
import { useAuth } from "@/hooks/useAuth";
import { storage } from "@/lib/storage";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NoticeAlert } from "@/components/notices/NoticeAlert";

function formatDateTime(isoString?: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function HomePage() {
  const location = useLocation();
  const { user } = useAuth();
  const cancelledFormTitle = (location.state as { cancelled?: string } | null)?.cancelled;

  return (
    <div className="space-y-8">
      {cancelledFormTitle && (
        <Alert>
          <AlertDescription>
            Your registration for &ldquo;{cancelledFormTitle}&rdquo; has been cancelled.
          </AlertDescription>
        </Alert>
      )}

      <div className="text-center">
        <h1 className="text-3xl font-bold">Our Upcoming Events</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {formConfigs.map((form) => {
          const submission = user ? storage.getFormSubmission(form.id) : null;
          const isRegistered = submission !== null && submission?.email === user?.email;
          const regStatus = getRegistrationStatus(form);

          // Registered users always get "Manage Registration" regardless of status.
          // Unregistered users see a status-appropriate button.
          let buttonLabel: string;
          let buttonVariant: "default" | "outline" | "secondary";
          let buttonDisabled = false;

          if (isRegistered) {
            buttonLabel = "Manage Registration";
            buttonVariant = "outline";
          } else if (regStatus === "open") {
            buttonLabel = "Register";
            buttonVariant = "default";
          } else if (regStatus === "not-yet-open") {
            buttonLabel = `Opens ${formatDateTime(form.registrationOpensAt)}`;
            buttonVariant = "secondary";
            buttonDisabled = true;
          } else {
            // closed
            buttonLabel = "Registrations Closed";
            buttonVariant = "secondary";
            buttonDisabled = true;
          }

          return (
            <Card key={form.id}>
              <CardHeader>
                <CardTitle>{form.title}</CardTitle>
                {form.description && (
                  <CardDescription>{form.description}</CardDescription>
                )}
                {form.startTime && form.endTime && (
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>
                      <span className="font-semibold">Start:</span>{" "}
                      {formatDateTime(form.startTime)}
                    </p>
                    <p>
                      <span className="font-semibold">End:</span>{" "}
                      {formatDateTime(form.endTime)}
                    </p>
                  </div>
                )}
                {buttonDisabled ? (
                  <Button
                    className="mt-4"
                    variant={buttonVariant}
                    disabled
                  >
                    {buttonLabel}
                  </Button>
                ) : (
                  <Button asChild className="mt-4" variant={buttonVariant}>
                    <Link to={`/form/${form.id}`}>{buttonLabel}</Link>
                  </Button>
                )}
                <NoticeAlert formId={form.id} />
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
