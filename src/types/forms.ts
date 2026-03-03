export type FieldType = "text" | "email" | "tel" | "number" | "textarea" | "select" | "radio" | "checkbox" | "checkbox-group";

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FormFieldConfig {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  validation?: FieldValidation;
  options?: FieldOption[];
  /** Dot-path to Discourse user data, e.g. "name", "email", "bio_raw", "user_fields.1" */
  discourseField?: string;
  /** If true, field is read-only for verified users (only when value exists in Discourse) */
  verifiedReadOnly?: boolean;
  /** If true, field is completely hidden for verified users */
  skipForVerified?: boolean;
  /** If true, offer to save this field back to the user's Discourse profile on submit */
  saveToProfile?: boolean;
  /** If true, field spans full width */
  fullWidth?: boolean;
  /** Show this field only when another field has a specific value. e.g. { field: "canBringCar", value: "yes" } */
  showWhen?: { field: string; value: string };
  /** Section name to group related fields together */
  section?: string;
}

export interface VerifiedSuccessInfo {
  /** Message shown to verified users after submission */
  message: string;
  /** Optional link URL (e.g. WhatsApp group invite) */
  linkUrl?: string;
  /** Label for the link button */
  linkLabel?: string;
}

export interface FormConfig {
  id: string;
  title: string;
  description?: string;
  startTime?: string; // ISO datetime string
  endTime?: string;   // ISO datetime string
  sheetTab: string;
  fields: FormFieldConfig[];
  submitLabel?: string;
  /** Shown to verified users on the success page after submission */
  verifiedSuccess?: VerifiedSuccessInfo;
}
