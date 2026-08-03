import { useParams, useSearchParams } from "react-router-dom";
import {
  allowsGuestRegistration,
  getFormConfig,
} from "@/config/forms";
import {
  hasWhitelistInviteParams,
  parseWhitelistInviteParams,
} from "@/lib/whitelist-invite";
import { ProtectedRoute } from "./ProtectedRoute";
import { FormPage } from "@/pages/FormPage";

/**
 * Guest-allowed forms skip login.
 * Whitelist invite links (?email= / ?phone=) also skip login so recipients can register.
 */
export function FormRoute() {
  const { formId } = useParams<{ formId: string }>();
  const [searchParams] = useSearchParams();
  const config = formId ? getFormConfig(formId) : undefined;
  const invite = parseWhitelistInviteParams(searchParams);
  const whitelistInviteAccess = Boolean(
    config?.allowsRegistrationWhitelist && hasWhitelistInviteParams(invite)
  );

  if ((formId && allowsGuestRegistration(formId)) || whitelistInviteAccess) {
    return <FormPage />;
  }
  return (
    <ProtectedRoute>
      <FormPage />
    </ProtectedRoute>
  );
}
