import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { getFormConfig, getRegistrationStatus } from "@/config/forms";
import { updateUserFields } from "@/lib/discourse-api";
import { storage } from "@/lib/storage";
import {
  cancelRegistration,
  getRegistrationStatusForSheet,
  reserveRegistrationSlot,
  updateRegistration,
} from "@/lib/google-sheets";
import { DynamicForm, type SaveToProfileField } from "@/components/forms/DynamicForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NoticeAlert } from "@/components/notices/NoticeAlert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CardMode = "view" | "change-dates" | "confirm-cancel";

export function FormPage() {
  const { formId } = useParams<{ formId: string }>();
  const { user, apiKey, refreshUser } = useAuth();
  const { isSubmitting, isDuplicate, error, submit } = useFormSubmit();
  const navigate = useNavigate();

  const config = formId ? getFormConfig(formId) : undefined;

  // Check if this user already submitted this form (client-side quick check)
  const submission = useMemo(() => {
    if (!config || !user) return null;
    const s = storage.getFormSubmission(config.id);
    return s !== null && s.email === user.email ? s : null;
  }, [config, user]);

  const alreadySubmitted = submission !== null || isDuplicate;

  // Parse stored nights from localStorage submission data
  const storedNights = useMemo(() => {
    const raw = submission?.data?.nights;
    if (typeof raw === "string" && raw.trim()) {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }, [submission]);

  // Find the nights field in config (used for change-dates UI)
  const nightsField = useMemo(
    () => config?.fields.find((f) => f.name === "nights"),
    [config]
  );

  // ---- Already-registered card state ----
  const [cardMode, setCardMode] = useState<CardMode>("view");
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [selectedNights, setSelectedNights] = useState<string[]>([]);
  const [capacityCheck, setCapacityCheck] = useState<{
    sheetTab: string | null;
    isFull: boolean;
    message: string | null;
    holdExpiresAt: string | null;
  }>({
    sheetTab: null,
    isFull: false,
    message: null,
    holdExpiresAt: null,
  });

  function openChangeDates() {
    setSelectedNights([...storedNights]);
    setCardError(null);
    setCardMode("change-dates");
  }

  async function handleCancelConfirm() {
    if (!apiKey) {
      setCardError("Your session expired. Please log in again.");
      return;
    }
    setCardLoading(true);
    setCardError(null);
    const result = await cancelRegistration(config!.sheetTab, apiKey);
    if (result.success) {
      storage.clearFormSubmission(config!.id);
      navigate("/", { state: { cancelled: config!.title } });
    } else {
      setCardError(result.message ?? result.error ?? "Failed to cancel. Please try again.");
      setCardLoading(false);
    }
  }

  async function handleUpdateDates() {
    if (!apiKey) {
      setCardError("Your session expired. Please log in again.");
      return;
    }
    if (selectedNights.length === 0) {
      setCardError("Please select at least one night.");
      return;
    }
    setCardLoading(true);
    setCardError(null);
    const nightsValue = selectedNights.join(", ");
    const result = await updateRegistration(config!.sheetTab, apiKey, {
      nights: nightsValue,
    });
    if (result.success) {
      storage.updateFormSubmissionData(config!.id, { nights: nightsValue });
      setCardMode("view");
    } else {
      setCardError(result.message ?? result.error ?? "Failed to update. Please try again.");
    }
    setCardLoading(false);
  }

  const regStatus = config ? getRegistrationStatus(config) : "open";
  const shouldCheckCapacity = Boolean(config && user && !alreadySubmitted && regStatus === "open");
  const isCheckingCapacity =
    shouldCheckCapacity && capacityCheck.sheetTab !== config?.sheetTab;

  useEffect(() => {
    let cancelled = false;

    if (!shouldCheckCapacity || !config) {
      return () => {
        cancelled = true;
      };
    }

    if (!apiKey) {
      return () => {
        cancelled = true;
      };
    }

    const checkPromise = config.requiresPayment
      ? reserveRegistrationSlot(config.sheetTab, apiKey, {
          formId: config.id,
          requiresPayment: true,
          reserveFields: config.fields.filter((field) => !field.uiOnly).map((field) => field.name),
        })
      : getRegistrationStatusForSheet(config.sheetTab, apiKey);

    checkPromise
      .then((result) => {
        if (cancelled) return;
        setCapacityCheck({
          sheetTab: config.sheetTab,
          isFull: Boolean(result.success && result.isFull),
          message: result.success && result.isFull
            ? (result.message || "Registrations are paused because the event is full.")
            : null,
          holdExpiresAt:
            config.requiresPayment && result.success && "expiresAt" in result
              ? (result.expiresAt as string | undefined) ?? null
              : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Fail open: allow submission if status check fails.
        setCapacityCheck({
          sheetTab: config.sheetTab,
          isFull: false,
          message: null,
          holdExpiresAt: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, config, shouldCheckCapacity]);

  // ---- Early returns ----

  if (!config) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-lg font-semibold">Form Not Found</h2>
        <p className="text-muted-foreground">
          The form &quot;{formId}&quot; does not exist.
        </p>
      </div>
    );
  }

  if (!user) return null;

  // Block new registrations when the window is closed/not-yet-open.
  // Already-registered users bypass this so they can still manage their registration.

  if (regStatus !== "open" && !alreadySubmitted) {
    const opensDate = config.registrationOpensAt
      ? new Date(config.registrationOpensAt).toLocaleString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              {regStatus === "closed" ? "Registration Closed" : "Registration Not Yet Open"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {regStatus === "closed"
                ? `Registration for ${config.title} has closed.`
                : `Registration for ${config.title} opens on ${opensDate}.`}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isCheckingCapacity) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Checking Availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Checking if registrations are still open for {config.title}...
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (shouldCheckCapacity && !isCheckingCapacity && capacityCheck.isFull) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Registration Full</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {capacityCheck.message ||
                "Registrations are paused because the event is full. Please contact the organisers if you wish to register."}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show interactive "Already Registered" card if duplicate detected (client or server)
  if (alreadySubmitted) {
    return (
      <div className="space-y-4">
        <NoticeAlert formId={config.id} />
        <div className="flex items-center justify-center py-12">

          {/* VIEW mode */}
          {cardMode === "view" && (
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>You&apos;re Registered ✓</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {storedNights.length > 0 && nightsField && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Attending:</span>{" "}
                    {storedNights
                      .map((v) => {
                        const opt = nightsField.options?.find((o) => o.value === v);
                        return opt ? opt.label : v;
                      })
                      .join(", ")}
                  </p>
                )}
                {cardError && (
                  <Alert variant="destructive">
                    <AlertDescription>{cardError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2">
                  {nightsField && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={openChangeDates}
                    >
                      Change Dates
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      setCardError(null);
                      setCardMode("confirm-cancel");
                    }}
                  >
                    Cancel Registration
                  </Button>
                </div>
                <Button asChild variant="ghost" className="w-full">
                  <Link to="/">Back to Home</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* CHANGE-DATES mode */}
          {cardMode === "change-dates" && nightsField && (
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Update your dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2">
                  {nightsField.options?.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selectedNights.includes(opt.value)}
                        onChange={(e) => {
                          setSelectedNights((prev) =>
                            e.target.checked
                              ? [...prev, opt.value]
                              : prev.filter((v) => v !== opt.value)
                          );
                        }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {cardError && (
                  <Alert variant="destructive">
                    <AlertDescription>{cardError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={cardLoading}
                    onClick={() => {
                      setCardError(null);
                      setCardMode("view");
                    }}
                  >
                    Go Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={cardLoading}
                    onClick={handleUpdateDates}
                  >
                    {cardLoading ? "Updating…" : "Confirm Update"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* CONFIRM-CANCEL mode */}
          {cardMode === "confirm-cancel" && (
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Cancel Registration?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This will remove your spot from{" "}
                  <span className="font-medium">{config.title}</span>. You can
                  re-register later if spots are available.
                </p>
                {cardError && (
                  <Alert variant="destructive">
                    <AlertDescription>{cardError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={cardLoading}
                    onClick={() => {
                      setCardError(null);
                      setCardMode("view");
                    }}
                  >
                    Go Back
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={cardLoading}
                    onClick={handleCancelConfirm}
                  >
                    {cardLoading ? "Cancelling…" : "Yes, Cancel"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    );
  }

  async function handleSubmit(
    data: Record<string, unknown>,
    fieldsToSave: SaveToProfileField[]
  ) {
    if (!apiKey) return;
    const result = await submit(config!.sheetTab, data, apiKey, {
      formId: config!.id,
      requiresPayment: Boolean(config!.requiresPayment),
    });

    if (result.success) {
      // Mark form as submitted in localStorage, storing the submitted data
      storage.markFormSubmitted(config!.id, user!.email, data);

      // Save fields to Discourse profile if requested
      if (fieldsToSave.length > 0 && apiKey) {
        try {
          const userFields: Record<string, string> = {};
          for (const field of fieldsToSave) {
            // discourseField is like "user_fields.2" — extract the ID
            const fieldId = field.discourseField.replace("user_fields.", "");
            userFields[fieldId] = field.value;
          }
          await updateUserFields(user!.username, apiKey, userFields);
          // Refresh user profile so next form load has the saved data
          await refreshUser();
        } catch {
          // Profile save failed — not critical, form was still submitted
          console.warn("Failed to save fields to Discourse profile");
        }
      }

      navigate("/", { state: { paymentConfirmed: config!.title } });
    } else if (result.error === "duplicate") {
      // Server detected duplicate — mark localStorage so future visits show the card
      storage.markFormSubmitted(config!.id, user!.email);
    }
  }

  return (
    <div className="space-y-4">
      <NoticeAlert formId={config.id} />
      {config.requiresPayment && (
        <Alert>
          <AlertTitle>Payment Window</AlertTitle>
          <AlertDescription>
            Your seat is temporarily held for 5 minutes. Complete payment and submit this form within
            5 minutes, otherwise your seat will be released.
            {capacityCheck.holdExpiresAt
              ? ` Hold valid until ${new Date(capacityCheck.holdExpiresAt).toLocaleTimeString("en-IN", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}.`
              : ""}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DynamicForm
        config={config}
        user={user}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
