/**
 * Hook that wraps submitToSheets() with React state for loading/error/success.
 * Also exposes `isDuplicate` so FormPage can show the "already registered" card.
 */
import { useState } from "react";
import { submitToSheets } from "@/lib/google-sheets";
import { registrationErrorMessage } from "@/lib/registration-errors";
import type { DiscourseUser } from "@/types/discourse";

interface SubmitState {
  isSubmitting: boolean;
  isSuccess: boolean;
  isDuplicate: boolean;
  error: string | null;
}

export function useFormSubmit() {
  const [state, setState] = useState<SubmitState>({
    isSubmitting: false,
    isSuccess: false,
    isDuplicate: false,
    error: null,
  });

  async function submit(
    sheetTab: string,
    formData: Record<string, unknown>,
    apiKey: string,
    options?: { formId?: string; requiresPayment?: boolean; user?: DiscourseUser | null }
  ) {
    setState({ isSubmitting: true, isSuccess: false, isDuplicate: false, error: null });

    try {
      const result = await submitToSheets(sheetTab, formData, apiKey, options);
      if (result.success) {
        setState({ isSubmitting: false, isSuccess: true, isDuplicate: false, error: null });
      } else {
        const isDuplicate = result.error === "duplicate";
        setState({
          isSubmitting: false,
          isSuccess: false,
          isDuplicate,
          error: registrationErrorMessage(result.error, result.message),
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      setState({ isSubmitting: false, isSuccess: false, isDuplicate: false, error: message });
      return { success: false, error: message };
    }
  }

  return { ...state, submit };
}
