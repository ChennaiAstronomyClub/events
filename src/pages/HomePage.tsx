import { Link, useLocation } from "react-router-dom";
import { getListedFormConfigs, getRegistrationStatus, isEventOver } from "@/config/forms";
import { useAuth } from "@/hooks/useAuth";
import { storage } from "@/lib/storage";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EventDescription } from "@/components/events/EventDescription";
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
  const routeState =
    (location.state as {
      cancelled?: string;
      holdExpired?: string;
      paymentConfirmed?: string;
    } | null) ?? null;
  const cancelledFormTitle = routeState?.cancelled;
  const holdExpiredFormTitle = routeState?.holdExpired;
  const paymentConfirmedFormTitle = routeState?.paymentConfirmed;

  return (
    <div className="space-y-8">
      {cancelledFormTitle && (
        <Alert>
          <AlertDescription>
            Your registration for &ldquo;{cancelledFormTitle}&rdquo; has been cancelled.
          </AlertDescription>
        </Alert>
      )}
      {holdExpiredFormTitle && (
        <Alert variant="destructive">
          <AlertDescription>
            Your seat hold for &ldquo;{holdExpiredFormTitle}&rdquo; expired after 5 minutes.
            Open the form again to reserve a new seat if spots are still available.
          </AlertDescription>
        </Alert>
      )}
      {paymentConfirmedFormTitle && (
        <Alert>
          <AlertDescription>
            Payment received for &ldquo;{paymentConfirmedFormTitle}&rdquo;. Your seat is confirmed.
          </AlertDescription>
        </Alert>
      )}

      <div className="text-center">
        <h1 className="text-3xl font-bold">Registrations</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {getListedFormConfigs().map((form) => {
          const submission = user ? storage.getFormSubmission(form.id) : null;
          const isRegistered = submission !== null && submission?.email === user?.email;
          const regStatus = getRegistrationStatus(form);

          // After the event ends, everyone sees a disabled "Registrations Closed" button.
          // Before then, registered users can manage their registration even if the window closed.
          let buttonLabel: string;
          let buttonVariant: "default" | "outline" | "secondary";
          let buttonDisabled = false;

          if (isEventOver(form)) {
            buttonLabel = "Registrations Closed";
            buttonVariant = "secondary";
            buttonDisabled = true;
          } else if (isRegistered) {
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
            <Card key={form.id} className="h-full">
              <CardHeader className="flex flex-1 flex-col">
                <CardTitle>{form.title}</CardTitle>
                {(form.description || form.eventInfoLink || form.talkTitle) && (
                  <EventDescription
                    description={form.description}
                    eventInfoLink={form.eventInfoLink}
                    talkTitle={form.talkTitle}
                    talkSpeaker={form.talkSpeaker}
                  />
                )}
                {(form.startTime && form.endTime) || form.feeInfo ? (
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {form.startTime && (
                      <p>
                        <span className="font-semibold">Start:</span>{" "}
                        {formatDateTime(form.startTime)}
                      </p>
                    )}
                    {form.endTime && (
                      <p>
                        <span className="font-semibold">End:</span>{" "}
                        {formatDateTime(form.endTime)}
                      </p>
                    )}
                    {form.feeInfo && (
                      <p>
                        <span className="font-semibold">Fee:</span>{" "}
                        {form.feeInfo}
                      </p>
                    )}
                  </div>
                ) : null}
                <NoticeAlert formId={form.id} />
              </CardHeader>
              <CardFooter className="pt-0">
                {buttonDisabled ? (
                  <Button
                    className="w-full"
                    variant={buttonVariant}
                    disabled
                  >
                    {buttonLabel}
                  </Button>
                ) : (
                  <Button asChild className="w-full" variant={buttonVariant}>
                    <Link to={`/form/${form.id}`}>{buttonLabel}</Link>
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
