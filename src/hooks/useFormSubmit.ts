/**
 * Hook that wraps submitToSheets() with React state for loading/error/success.
 * Also exposes `isDuplicate` so FormPage can show the "already registered" card.
 */
import { useState } from "react";
import {
  submitToSheets,
  type GuestUser,
  type RegistrationCallOptions,
} from "@/lib/google-sheets";
import { isBlacklistedError, registrationErrorMessage } from "@/lib/registration-errors";
import type { DiscourseUser } from "@/types/discourse";

interface SubmitState {
  isSubmitting: boolean;
  isSuccess: boolean;
  isDuplicate: boolean;
  isBlacklisted: boolean;
  error: string | null;
}

export function useFormSubmit() {
  const [state, setState] = useState<SubmitState>({
    isSubmitting: false,
    isSuccess: false,
    isDuplicate: false,
    isBlacklisted: false,
    error: null,
  });

  async function submit(
    sheetTab: string,
    formData: Record<string, unknown>,
    options: RegistrationCallOptions & {
      requiresPayment?: boolean;
      user?: DiscourseUser | null;
      guestUser?: GuestUser;
      holdToken?: string;
    }
  ) {
    setState({
      isSubmitting: true,
      isSuccess: false,
      isDuplicate: false,
      isBlacklisted: false,
      error: null,
    });

    try {
      const result = await submitToSheets(sheetTab, formData, options);
      if (result.success) {
        setState({
          isSubmitting: false,
          isSuccess: true,
          isDuplicate: false,
          isBlacklisted: false,
          error: null,
        });
      } else {
        const isDuplicate = result.error === "duplicate";
        const isBlacklisted = isBlacklistedError(result.error);
        setState({
          isSubmitting: false,
          isSuccess: false,
          isDuplicate,
          isBlacklisted,
          error: isBlacklisted
            ? null
            : registrationErrorMessage(result.error, result.message),
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      setState({
        isSubmitting: false,
        isSuccess: false,
        isDuplicate: false,
        isBlacklisted: false,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  return { ...state, submit };
}
