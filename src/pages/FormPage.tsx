import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { useHoldCountdown } from "@/hooks/useHoldCountdown";
import { getFormConfig, getRegistrationStatus, isEventOver } from "@/config/forms";
import { isVerifiedUser, VERIFIED_GROUP_NAME, PHONE_FIELD_ID } from "@/config/discourse-fields";
import { CAPACITY_CHECK_SAFETY_MS } from "@/lib/api-timeouts";
import { formatIstDateTime } from "@/lib/datetime";
import { updateUserFields } from "@/lib/discourse-api";
import {
  hasWhitelistInviteParams,
  parseWhitelistInviteParams,
} from "@/lib/whitelist-invite";
import {
  isBlacklistedError,
  isHoldExpiredError,
  isRetriableError,
  registrationErrorMessage,
  CONTACT_PAGE_URL,
} from "@/lib/registration-errors";
import { storage } from "@/lib/storage";
import { clearHoldToken, getHoldToken, setHoldToken } from "@/lib/guest-hold-token";
import {
  cancelRegistration,
  getRegistrationStatusForSheet,
  releaseExpiredHold,
  reserveRegistrationSlot,
  updateRegistration,
} from "@/lib/google-sheets";
import { useRegistrationWhitelistCheck } from "@/hooks/useRegistrationWhitelistCheck";
import { DynamicForm, type SaveToProfileField } from "@/components/forms/DynamicForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NoticeAlert } from "@/components/notices/NoticeAlert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CardMode = "view" | "change-dates" | "confirm-cancel";
type CapacityCheckStatus = "idle" | "checking" | "ready" | "error";

interface CapacityCheckState {
  sheetTab: string | null;
  status: CapacityCheckStatus;
  isFull: boolean;
  isBlacklisted: boolean;
  message: string | null;
  holdExpiresAt: string | null;
  hasValidHold: boolean;
  errorMessage: string | null;
}

const EMPTY_CAPACITY_CHECK: CapacityCheckState = {
  sheetTab: null,
  status: "idle",
  isFull: false,
  isBlacklisted: false,
  message: null,
  holdExpiresAt: null,
  hasValidHold: false,
  errorMessage: null,
};

export function FormPage() {
  const { formId } = useParams<{ formId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, apiKey, refreshUser, login, isLoading: authLoading } = useAuth();
  const { isSubmitting, isDuplicate, isBlacklisted: submitBlacklisted, error, submit } =
    useFormSubmit();
  const navigate = useNavigate();

  const config = formId ? getFormConfig(formId) : undefined;
  const inviteIdentity = useMemo(
    () => parseWhitelistInviteParams(searchParams),
    [searchParams]
  );
  const hasInvite = hasWhitelistInviteParams(inviteIdentity);
  const isWhitelistInviteGuest = Boolean(
    config?.allowsRegistrationWhitelist && hasInvite && !user
  );
  const isGuestMode = Boolean(
    ((config?.allowGuestRegistration && !user) || isWhitelistInviteGuest)
  );
  const isBackfillForm = Boolean(config?.updateExistingRegistration);
  const [submissionRev, setSubmissionRev] = useState(0);
  const [backfillSubmitting, setBackfillSubmitting] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [guestEmail, setGuestEmail] = useState<string | null>(() => {
    const email = inviteIdentity.email?.trim();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  });
  const [guestPhone, setGuestPhone] = useState<string | null>(() => {
    const phone = inviteIdentity.phone?.trim();
    if (!phone) return null;
    return phone.replace(/\D/g, "").length >= 10 ? phone : null;
  });
  const [continuingAsGuest, setContinuingAsGuest] = useState(() => isWhitelistInviteGuest);
  const [emailGateDraft, setEmailGateDraft] = useState(
    () => inviteIdentity.email?.trim() ?? ""
  );
  const [phoneGateDraft, setPhoneGateDraft] = useState(
    () => inviteIdentity.phone?.trim() ?? ""
  );
  const [emailGateError, setEmailGateError] = useState<string | null>(null);

  // Check if this user already submitted this form (client-side quick check)
  const submission = useMemo(() => {
    if (!config) return null;
    const s = storage.getFormSubmission(config.id);
    if (!s) return null;
    if (user) return s.email === user.email ? s : null;
    if (config.allowGuestRegistration || isWhitelistInviteGuest) return s;
    return null;
  }, [config, user, submissionRev, isWhitelistInviteGuest]);

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
  const [capacityCheck, setCapacityCheck] =
    useState<CapacityCheckState>(EMPTY_CAPACITY_CHECK);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const autoRetryCountRef = useRef(0);
  const capacityCheckGenerationRef = useRef(0);
  const hadActiveHoldRef = useRef(false);
  const holdReleaseStartedRef = useRef(false);

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
    const result = await cancelRegistration(config!.sheetTab, {
      formId: config!.id,
      apiKey: apiKey!,
      user,
    });
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
    const result = await updateRegistration(
      config!.sheetTab,
      { nights: nightsValue },
      { formId: config!.id, apiKey: apiKey!, user }
    );
    if (result.success) {
      storage.updateFormSubmissionData(config!.id, { nights: nightsValue });
      setCardMode("view");
    } else {
      setCardError(result.message ?? result.error ?? "Failed to update. Please try again.");
    }
    setCardLoading(false);
  }

  const regStatus = config ? getRegistrationStatus(config) : "open";
  const identityPhone =
    user?.user_fields?.[PHONE_FIELD_ID] ?? guestPhone ?? inviteIdentity.phone ?? null;
  const identityEmail = user?.email ?? guestEmail ?? inviteIdentity.email ?? null;
  const needsWhitelistCheck = Boolean(
    config?.allowsRegistrationWhitelist &&
      regStatus !== "open" &&
      config &&
      !isEventOver(config) &&
      !alreadySubmitted &&
      ((user && apiKey) || hasInvite)
  );
  const { status: whitelistStatus, allowed: isWhitelisted } =
    useRegistrationWhitelistCheck({
      enabled: needsWhitelistCheck,
      formId: config?.id,
      apiKey,
      user,
      email: identityEmail,
      phone: identityPhone,
    });
  const registrationAllowed =
    regStatus === "open" ||
    Boolean(isWhitelisted && config && !isEventOver(config));
  const requiresPayment = Boolean(config?.requiresPayment);
  const guestIdentityReady = Boolean(
    guestEmail && (!requiresPayment || guestPhone)
  );
  const hasRegistrationIdentity = Boolean(user || (isGuestMode && guestIdentityReady));
  const shouldCheckCapacity = Boolean(
    config &&
      !config.skipCapacityCheck &&
      hasRegistrationIdentity &&
      !alreadySubmitted &&
      registrationAllowed &&
      !isBackfillForm
  );
  const isCheckingCapacity =
    shouldCheckCapacity && capacityCheck.status === "checking";
  const capacityCheckFailed =
    shouldCheckCapacity && capacityCheck.status === "error";
  const isRegistrationBlocked = capacityCheck.isBlacklisted || submitBlacklisted;

  // Show verifiedSuccess info on the "already registered" card for:
  //  - paid events → always (all users need the WhatsApp link to join)
  //  - free events → only verified users (same logic as the /success page)
  const showVerifiedSuccess = Boolean(
    config?.verifiedSuccess &&
      (requiresPayment || isVerifiedUser(user?.groups ?? []) || isGuestMode)
  );

  const { expired: holdExpired, formatted: holdCountdown } = useHoldCountdown(
    requiresPayment ? capacityCheck.holdExpiresAt : null
  );

  const hasActiveHold =
    requiresPayment && capacityCheck.hasValidHold && !holdExpired;

  const triggerAutoRetry = useCallback(() => {
    if (autoRetryCountRef.current >= 1) return false;
    autoRetryCountRef.current += 1;
    setCapacityCheck({ ...EMPTY_CAPACITY_CHECK, status: "checking" });
    setCheckAttempt((n) => n + 1);
    return true;
  }, []);

  const retryCapacityCheck = useCallback(() => {
    autoRetryCountRef.current = 0;
    hadActiveHoldRef.current = false;
    holdReleaseStartedRef.current = false;
    setCapacityCheck({ ...EMPTY_CAPACITY_CHECK, status: "checking" });
    setCheckAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!shouldCheckCapacity) {
      setCapacityCheck(EMPTY_CAPACITY_CHECK);
    }
  }, [shouldCheckCapacity]);

  useEffect(() => {
    if (hasActiveHold) {
      hadActiveHoldRef.current = true;
    }
  }, [hasActiveHold]);

  useEffect(() => {
    if (holdExpired && capacityCheck.hasValidHold) {
      setCapacityCheck((prev) => ({
        ...prev,
        hasValidHold: false,
        holdExpiresAt: null,
      }));
    }
  }, [holdExpired, capacityCheck.hasValidHold]);

  useEffect(() => {
    if (!holdExpired || !requiresPayment || !config) return;
    if (!hadActiveHoldRef.current || holdReleaseStartedRef.current) return;

    holdReleaseStartedRef.current = true;
    if (isGuestMode) {
      const holdToken = getHoldToken(config.id);
      if (holdToken) {
        releaseExpiredHold(config.sheetTab, {
          formId: config.id,
          holdToken,
        });
        clearHoldToken(config.id);
      }
    } else {
      if (!apiKey) return;
      releaseExpiredHold(config.sheetTab, {
        formId: config.id,
        apiKey,
        user,
      });
    }
    navigate("/", { state: { holdExpired: config.title }, replace: true });
  }, [holdExpired, requiresPayment, config, apiKey, user, isGuestMode, navigate]);

  useEffect(() => {
    let cancelled = false;
    const generation = ++capacityCheckGenerationRef.current;

    if (!shouldCheckCapacity || !config) {
      return () => {
        cancelled = true;
      };
    }

    const sheetTab = config.sheetTab;
    const needsPayment = Boolean(config.requiresPayment);

    setCapacityCheck((prev) => ({
      ...prev,
      status: "checking",
      sheetTab: null,
      isBlacklisted: false,
      errorMessage: null,
    }));

    function finishError(message: string) {
      setCapacityCheck({
        sheetTab,
        status: "error",
        isFull: false,
        isBlacklisted: false,
        message: null,
        holdExpiresAt: null,
        hasValidHold: false,
        errorMessage: message,
      });
    }

    function applyResult(result: {
      success?: boolean;
      isFull?: boolean;
      error?: string;
      message?: string;
      expiresAt?: string;
      holdToken?: string;
    }) {
      if (result.error === "duplicate") {
        const markEmail = user?.email ?? guestEmail ?? "";
        if (markEmail) storage.markFormSubmitted(config!.id, markEmail);
        setSubmissionRev((n) => n + 1);
        return;
      }

      if (isBlacklistedError(result.error)) {
        setCapacityCheck({
          sheetTab,
          status: "ready",
          isFull: false,
          isBlacklisted: true,
          message: registrationErrorMessage(result.error, result.message),
          holdExpiresAt: null,
          hasValidHold: false,
          errorMessage: null,
        });
        return;
      }

      // Reserve success sets isFull when the event hits capacity (activeCount >= limit).
      // That is informational for others — a user with expiresAt must not be turned away.
      // Whitelisted identities may register even when the event reports full.
      const isFull =
        !isWhitelisted &&
        (result.error === "full" ||
          (Boolean(result.success && result.isFull) && !result.expiresAt));

      if (isFull) {
        setCapacityCheck({
          sheetTab,
          status: "ready",
          isFull: true,
          isBlacklisted: false,
          message:
            result.message ||
            "Registrations are paused because the event is full. Please contact the organisers if you wish to register.",
          holdExpiresAt: null,
          hasValidHold: false,
          errorMessage: null,
        });
        return;
      }

      if (needsPayment) {
        const hasHold = Boolean(result.success && result.expiresAt);
        if (!hasHold) {
          // Retry only on busy/timeout — not on ambiguous success (can double-append).
          if (!result.success && isRetriableError(result.error) && triggerAutoRetry()) {
            return;
          }
          finishError(registrationErrorMessage(result.error, result.message));
          return;
        }
        if (result.holdToken) {
          setHoldToken(config!.id, result.holdToken);
        }
        setCapacityCheck({
          sheetTab,
          status: "ready",
          isFull: false,
          isBlacklisted: false,
          message: null,
          holdExpiresAt: result.expiresAt ?? null,
          hasValidHold: true,
          errorMessage: null,
        });
        return;
      }

      if (result.success) {
        setCapacityCheck({
          sheetTab,
          status: "ready",
          isFull: false,
          isBlacklisted: false,
          message: null,
          holdExpiresAt: null,
          hasValidHold: true,
          errorMessage: null,
        });
        return;
      }

      finishError(registrationErrorMessage(result.error, result.message));
    }

    let settled = false;

    const safetyTimeoutId = window.setTimeout(() => {
      if (cancelled || settled || generation !== capacityCheckGenerationRef.current) return;
      finishError(
        "Could not verify availability in time. Please check your connection and try again."
      );
    }, CAPACITY_CHECK_SAFETY_MS);

    if (!isGuestMode && !apiKey) {
      finishError("Your session expired. Please log in again.");
      return () => {
        cancelled = true;
        window.clearTimeout(safetyTimeoutId);
      };
    }

    const callOptions = {
      formId: config.id,
      apiKey: apiKey ?? undefined,
      user: user ?? undefined,
      guestUser:
        isGuestMode && guestEmail ? { email: guestEmail } : undefined,
      phone: identityPhone ?? undefined,
      email: !user ? identityEmail ?? undefined : undefined,
    };

    const checkPromise = needsPayment
      ? reserveRegistrationSlot(sheetTab, {
          ...callOptions,
          requiresPayment: true,
        })
      : getRegistrationStatusForSheet(sheetTab, callOptions);

    checkPromise
      .then((result) => {
        if (cancelled || generation !== capacityCheckGenerationRef.current) return;
        settled = true;
        applyResult(result);
      })
      .catch(() => {
        if (cancelled || generation !== capacityCheckGenerationRef.current) return;
        settled = true;
        finishError("Could not verify availability. Please try again.");
      })
      .finally(() => {
        settled = true;
        window.clearTimeout(safetyTimeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimeoutId);
    };
  }, [
    apiKey,
    user?.email,
    user?.username,
    guestEmail,
    guestPhone,
    identityPhone,
    identityEmail,
    isGuestMode,
    isWhitelisted,
    config,
    shouldCheckCapacity,
    checkAttempt,
    triggerAutoRetry,
  ]);

  const canShowRegistrationForm = isBackfillForm
    ? registrationAllowed
    : config?.skipCapacityCheck
      ? registrationAllowed &&
        hasRegistrationIdentity &&
        !alreadySubmitted &&
        !submitBlacklisted
      : shouldCheckCapacity &&
        capacityCheck.status === "ready" &&
        !capacityCheck.isBlacklisted &&
        !submitBlacklisted &&
        (!capacityCheck.isFull || isWhitelisted) &&
        (!requiresPayment || hasActiveHold);

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

  if (!user && !config.allowGuestRegistration && !isWhitelistInviteGuest) return null;

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  function handleSignInWithForum() {
    storage.setReturnTo(location.pathname);
    login();
  }

  function handleContinueAsGuest() {
    setContinuingAsGuest(true);
  }

  function handleEmailGateContinue() {
    const email = emailGateDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailGateError("Please enter a valid email address.");
      return;
    }
    if (requiresPayment) {
      const phone = phoneGateDraft.trim();
      if (phone.replace(/\D/g, "").length < 10) {
        setEmailGateError("Please enter a valid 10-digit mobile number.");
        return;
      }
      setGuestPhone(phone);
    }
    setEmailGateError(null);
    setGuestEmail(email);
    autoRetryCountRef.current = 0;
    hadActiveHoldRef.current = false;
    holdReleaseStartedRef.current = false;
    setCapacityCheck({ ...EMPTY_CAPACITY_CHECK, status: "checking" });
    setCheckAttempt((n) => n + 1);
  }

  const showAuthChoice =
    isGuestMode &&
    !isWhitelistInviteGuest &&
    !continuingAsGuest &&
    !alreadySubmitted &&
    registrationAllowed &&
    !isBackfillForm &&
    !isEventOver(config);

  const showEmailGate =
    isGuestMode &&
    continuingAsGuest &&
    !guestIdentityReady &&
    !alreadySubmitted &&
    registrationAllowed &&
    !isBackfillForm;

  if (showAuthChoice) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Register for {config.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in with your CAC Forum account to pre-fill your details and manage
              your registration later, or continue as a guest with your email.
            </p>
            <Button className="w-full" onClick={handleSignInWithForum}>
              Sign in with CAC Forum
            </Button>
            <Button className="w-full" variant="outline" onClick={handleContinueAsGuest}>
              Continue as guest
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showEmailGate) {
    const invitePhoneLocked = Boolean(inviteIdentity.phone?.trim());
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              {requiresPayment ? "Enter your details" : "Enter your email"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isWhitelistInviteGuest
                ? `Enter the details to use for your ${config.title} registration.`
                : requiresPayment
                  ? `We'll check this before reserving a seat for ${config.title}.`
                  : `We'll reserve a seat for 5 minutes while you complete registration for ${config.title}.`}
            </p>
            <div className="space-y-2">
              <Label htmlFor="guest-email">Email ID</Label>
              <Input
                id="guest-email"
                type="email"
                autoComplete="email"
                value={emailGateDraft}
                onChange={(e) => setEmailGateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEmailGateContinue();
                }}
                placeholder="you@example.com"
              />
            </div>
            {requiresPayment && (
              <div className="space-y-2">
                <Label htmlFor="guest-phone">Mobile number</Label>
                <Input
                  id="guest-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phoneGateDraft}
                  readOnly={invitePhoneLocked}
                  onChange={(e) => setPhoneGateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEmailGateContinue();
                  }}
                  placeholder="10-digit mobile number"
                />
              </div>
            )}
            {emailGateError && (
              <p className="text-sm text-destructive">{emailGateError}</p>
            )}
            <Button className="w-full" onClick={handleEmailGateContinue}>
              Continue
            </Button>
            {!isWhitelistInviteGuest && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setContinuingAsGuest(false);
                  setEmailGateDraft("");
                  setPhoneGateDraft("");
                  setEmailGateError(null);
                }}
              >
                Sign in with forum instead
              </Button>
            )}
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isEventOver(config)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Registration Closed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This event has ended.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Block new registrations when the window is closed/not-yet-open.
  // Whitelisted emails/phones and already-registered users bypass this.

  if (needsWhitelistCheck && whitelistStatus === "checking") {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Checking Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Checking whether you can still register for {config.title}...
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!registrationAllowed && !alreadySubmitted) {
    const opensDate = formatIstDateTime(config.registrationOpensAt);
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
                ? (config.registrationClosedMessage ??
                  `Registration for ${config.title} has closed.`)
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

  if (capacityCheckFailed) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Could Not Verify Availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {capacityCheck.errorMessage ??
                "We could not confirm whether registrations are still open. Please try again."}
            </p>
            <Button className="w-full" onClick={retryCapacityCheck}>
              Try Again
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (
    shouldCheckCapacity &&
    capacityCheck.status === "ready" &&
    capacityCheck.isFull &&
    !isWhitelisted
  ) {
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

  if (isRegistrationBlocked) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {capacityCheck.message ||
                "We can't complete this registration. Please email us using the contact page on our website."}
            </p>
            <Button asChild className="w-full">
              <a href={CONTACT_PAGE_URL} target="_blank" rel="noopener noreferrer">
                Open contact page
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show interactive "Already Registered" card if duplicate detected (client or server)
  if (alreadySubmitted && !isBackfillForm) {
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
                {showVerifiedSuccess && config.verifiedSuccess && (
                  <div className="rounded-lg border bg-green-50 p-4 space-y-3">
                    <p className="text-sm text-green-900">{config.verifiedSuccess.message}</p>
                    {config.verifiedSuccess.linkUrl && (
                      <Button asChild className="w-full">
                        <a
                          href={config.verifiedSuccess.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {config.verifiedSuccess.linkLabel || "Open Link"}
                        </a>
                      </Button>
                    )}
                  </div>
                )}
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
                  {!isGuestMode && nightsField && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={openChangeDates}
                    >
                      Change Dates
                    </Button>
                  )}
                  {!isGuestMode && (
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
                  )}
                </div>
                {isGuestMode && (
                  <p className="text-xs text-muted-foreground">
                    To cancel your registration, please contact the organisers.
                  </p>
                )}
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

  async function saveFieldsToProfile(fieldsToSave: SaveToProfileField[]) {
    if (fieldsToSave.length === 0 || !apiKey || !user) return;
    try {
      const userFields: Record<string, string> = {};
      for (const field of fieldsToSave) {
        const fieldId = field.discourseField.replace("user_fields.", "");
        userFields[fieldId] = field.value;
      }
      await updateUserFields(user.username, apiKey, userFields);
      await refreshUser();
    } catch {
      console.warn("Failed to save fields to Discourse profile");
    }
  }

  async function handleSubmit(
    data: Record<string, unknown>,
    fieldsToSave: SaveToProfileField[]
  ) {
    if (isGuestMode) {
      if (!guestEmail) return;

      if (config!.requiresPayment && !hasActiveHold) {
        retryCapacityCheck();
        return;
      }

      const holdToken = getHoldToken(config!.id) ?? undefined;
      const result = await submit(config!.sheetTab, data, {
        formId: config!.id,
        requiresPayment: Boolean(config!.requiresPayment),
        guestUser: { email: guestEmail },
        holdToken,
        phone:
          (typeof data.phone === "string" && data.phone.trim()) ||
          guestPhone ||
          inviteIdentity.phone ||
          undefined,
      });

      if (isHoldExpiredError(result.error)) {
        retryCapacityCheck();
        return;
      }

      const submitEmail =
        typeof data.email === "string" && data.email.trim()
          ? data.email.trim()
          : guestEmail;

      if (result.success) {
        clearHoldToken(config!.id);
        storage.markFormSubmitted(config!.id, submitEmail, data);
        navigate("/success", {
          state: {
            formId: config!.id,
            formTitle: config!.title,
            verifiedSuccess: config!.verifiedSuccess,
          },
        });
      } else if (result.error === "duplicate") {
        storage.markFormSubmitted(config!.id, submitEmail);
      }
      return;
    }

    if (!apiKey || !user) return;

    if (config!.updateExistingRegistration) {
      setBackfillSubmitting(true);
      setBackfillError(null);
      const memberType = isVerifiedUser(user.groups) ? VERIFIED_GROUP_NAME : "regular";
      const updates = { ...data, username: user.username, memberType };
      const result = await updateRegistration(config!.sheetTab, updates, {
        formId: config!.id,
        apiKey,
        user,
      });
      setBackfillSubmitting(false);

      if (result.success) {
        await saveFieldsToProfile(fieldsToSave);
        navigate("/success", {
          state: {
            formId: config!.id,
            formTitle: config!.title,
            backfillComplete: true,
          },
        });
      } else {
        setBackfillError(registrationErrorMessage(result.error, result.message));
      }
      return;
    }

    if (config!.requiresPayment && !hasActiveHold) {
      retryCapacityCheck();
      return;
    }

    const result = await submit(config!.sheetTab, data, {
      formId: config!.id,
      requiresPayment: Boolean(config!.requiresPayment),
      apiKey,
      user,
      phone:
        (typeof data.phone === "string" && data.phone.trim()) ||
        identityPhone ||
        undefined,
    });

    if (isHoldExpiredError(result.error)) {
      retryCapacityCheck();
      return;
    }

    if (result.success) {
      storage.markFormSubmitted(config!.id, user.email, data);
      await saveFieldsToProfile(fieldsToSave);

      const showVerifiedSuccess = Boolean(
        config!.verifiedSuccess &&
          (config!.requiresPayment || isVerifiedUser(user.groups))
      );

      navigate("/success", {
        state: {
          formId: config!.id,
          formTitle: config!.title,
          verifiedSuccess: showVerifiedSuccess ? config!.verifiedSuccess : undefined,
        },
      });
    } else if (result.error === "duplicate") {
      storage.markFormSubmitted(config!.id, user.email);
    }
  }

  if (!canShowRegistrationForm) {
    return null;
  }

  return (
    <div className="space-y-4">
      <NoticeAlert formId={config.id} />
      {config.requiresPayment && (
        <Alert>
          <AlertTitle>Payment Window</AlertTitle>
          <AlertDescription>
            Your seat is held for 5 minutes. Complete payment and submit within that time.
            {holdCountdown
              ? ` Time remaining: ${holdCountdown}.`
              : capacityCheck.holdExpiresAt
                ? ` Hold valid until ${new Date(capacityCheck.holdExpiresAt).toLocaleTimeString("en-IN", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}.`
                : ""}
          </AlertDescription>
        </Alert>
      )}
      {(error || backfillError) && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{backfillError ?? error}</AlertDescription>
        </Alert>
      )}
      <DynamicForm
        config={config}
        user={user ?? null}
        prefillValues={
          isGuestMode
            ? {
                ...(guestEmail ? { email: guestEmail } : {}),
                ...(guestPhone || inviteIdentity.phone
                  ? { phone: guestPhone ?? inviteIdentity.phone ?? "" }
                  : {}),
              }
            : undefined
        }
        readOnlyFields={(() => {
          if (!isGuestMode) return undefined;
          const fields: string[] = [];
          if (guestEmail) {
            // Lock email when it came from the invite link or the open-guest email gate.
            if (
              !isWhitelistInviteGuest ||
              (inviteIdentity.email &&
                guestEmail.toLowerCase() === inviteIdentity.email.toLowerCase())
            ) {
              fields.push("email");
            }
          }
          if (guestPhone || inviteIdentity.phone) fields.push("phone");
          return fields.length > 0 ? fields : undefined;
        })()}
        onSubmit={handleSubmit}
        isSubmitting={isBackfillForm ? backfillSubmitting : isSubmitting}
        submitDisabled={config.requiresPayment && !hasActiveHold}
      />
    </div>
  );
}
