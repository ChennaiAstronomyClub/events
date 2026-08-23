import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  getListedFormConfigs,
  getRegistrationStatus,
  isEventOver,
} from "@/config/forms";
import { PHONE_FIELD_ID } from "@/config/discourse-fields";
import { useAuth } from "@/hooks/useAuth";
import { useRegistrationWhitelistCheck } from "@/hooks/useRegistrationWhitelistCheck";
import { formatIstDateTime } from "@/lib/datetime";
import { storage } from "@/lib/storage";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EventDescription } from "@/components/events/EventDescription";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NoticeAlert } from "@/components/notices/NoticeAlert";
import type { FormConfig } from "@/types/forms";

function EventRegistrationCard({
  form,
  userEmail,
  userPhone,
  apiKey,
  user,
}: {
  form: FormConfig;
  userEmail: string | undefined;
  userPhone: string | undefined;
  apiKey: string | null;
  user: ReturnType<typeof useAuth>["user"];
}) {
  const storedSubmission = storage.getFormSubmission(form.id);
  const isRegistered = form.allowGuestRegistration
    ? storedSubmission !== null
    : storedSubmission !== null && storedSubmission.email === userEmail;
  const regStatus = getRegistrationStatus(form);
  const eventOver = isEventOver(form);
  const needsWhitelistCheck = Boolean(
    form.allowsRegistrationWhitelist &&
      regStatus === "closed" &&
      !eventOver &&
      !isRegistered &&
      user &&
      apiKey
  );
  const { allowed: isWhitelisted } = useRegistrationWhitelistCheck({
    enabled: needsWhitelistCheck,
    formId: form.id,
    apiKey,
    user,
    email: userEmail,
    phone: userPhone,
  });
  const canRegisterDespiteClosed =
    isWhitelisted && !eventOver && !isRegistered;

  let buttonLabel: string;
  let buttonVariant: "default" | "outline" | "secondary";
  let buttonDisabled = false;

  if (eventOver) {
    buttonLabel = "Registrations Closed";
    buttonVariant = "secondary";
    buttonDisabled = true;
  } else if (isRegistered) {
    buttonLabel = "Manage Registration";
    buttonVariant = "outline";
  } else if (regStatus === "open" || canRegisterDespiteClosed) {
    buttonLabel = "Register";
    buttonVariant = "default";
  } else if (regStatus === "not-yet-open") {
    buttonLabel = `Opens ${formatIstDateTime(form.registrationOpensAt)}`;
    buttonVariant = "secondary";
    buttonDisabled = true;
  } else {
    buttonLabel = "Registrations Closed";
    buttonVariant = "secondary";
    buttonDisabled = true;
  }

  return (
    <Card className="h-full">
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
                {formatIstDateTime(form.startTime)}
              </p>
            )}
            {form.endTime && (
              <p>
                <span className="font-semibold">End:</span>{" "}
                {formatIstDateTime(form.endTime)}
              </p>
            )}
            {form.feeInfo && (
              <div>
                <p>
                  <span className="font-semibold">Fee:</span>
                </p>
                <div className="whitespace-pre-line">{form.feeInfo}</div>
              </div>
            )}
          </div>
        ) : null}
        <NoticeAlert formId={form.id} />
        {(regStatus === "closed" || eventOver) &&
          !canRegisterDespiteClosed &&
          form.registrationClosedMessage && (
            <p className="mt-3 text-sm text-muted-foreground">
              {form.registrationClosedMessage}
            </p>
          )}
      </CardHeader>
      <CardFooter className="pt-0">
        {buttonDisabled ? (
          <Button className="w-full" variant={buttonVariant} disabled>
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
}

export function HomePage() {
  const location = useLocation();
  const { user, apiKey } = useAuth();
  const forms = useMemo(() => getListedFormConfigs(), []);
  const routeState =
    (location.state as {
      cancelled?: string;
      holdExpired?: string;
      paymentConfirmed?: string;
    } | null) ?? null;
  const cancelledFormTitle = routeState?.cancelled;
  const holdExpiredFormTitle = routeState?.holdExpired;
  const paymentConfirmedFormTitle = routeState?.paymentConfirmed;
  const userPhone = user?.user_fields?.[PHONE_FIELD_ID];

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
        {forms.map((form) => (
          <EventRegistrationCard
            key={form.id}
            form={form}
            userEmail={user?.email}
            userPhone={userPhone}
            apiKey={apiKey}
            user={user}
          />
        ))}
      </div>
    </div>
  );
}
