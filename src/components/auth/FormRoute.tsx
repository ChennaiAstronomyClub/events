import { useParams } from "react-router-dom";
import { allowsGuestRegistration } from "@/config/forms";
import { ProtectedRoute } from "./ProtectedRoute";
import { FormPage } from "@/pages/FormPage";

/**
 * Guest-allowed forms skip login; all other forms require Discourse auth.
 */
export function FormRoute() {
  const { formId } = useParams<{ formId: string }>();
  if (formId && allowsGuestRegistration(formId)) {
    return <FormPage />;
  }
  return (
    <ProtectedRoute>
      <FormPage />
    </ProtectedRoute>
  );
}
