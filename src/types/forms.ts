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
  helperText?: string;
  helperLinkLabel?: string;
  helperLinkUrl?: string;
  /** Value shown with a copy button (e.g. UPI ID) */
  copyableValue?: string;
  copyableLabel?: string;
  /** Optional image shown below helper text (e.g. UPI QR code) */
  helperImageUrl?: string;
  helperImageAlt?: string;
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
  /** If true, field is used only for UI flow control and is not submitted */
  uiOnly?: boolean;
  /** If true, field spans full width */
  fullWidth?: boolean;
  /** Show this field only when another field has a specific value. e.g. { field: "canBringCar", value: "yes" } */
  showWhen?: { field: string; value: string };
  /** Section name to group related fields together */
  section?: string;
}

export interface EventInfoLink {
  /** Prompt shown above the link, e.g. "Please read the event details before registering." */
  message: string;
  url: string;
  linkLabel?: string;
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
  /** Replaces a long description with a short prompt and external details link */
  eventInfoLink?: EventInfoLink;
  /** If true, seat is held as Pending and expires unless payment is confirmed. */
  requiresPayment?: boolean;
  /** Prominent talk/session title shown on event cards (e.g. lecture name) */
  talkTitle?: string;
  /** Speaker or subtitle line shown below talkTitle */
  talkSpeaker?: string;
  startTime?: string; // ISO datetime string — event start time (display only)
  endTime?: string;   // ISO datetime string — event end time (display only)
  feeInfo?: string;   // Display-only fee/cost line on event cards
  /** ISO datetime — registration is blocked before this time */
  registrationOpensAt?: string;
  /** ISO datetime — registration is blocked after this time */
  registrationClosesAt?: string;
  sheetTab: string;
  fields: FormFieldConfig[];
  /** Require at least one of these fields to be filled */
  atLeastOneOf?: {
    fields: string[];
    message: string;
  };
  /** When `when` matches, sum of numeric fields must not exceed `max` */
  sumAtMost?: {
    fields: string[];
    max: number;
    when?: { field: string; value: string };
    message: string;
  };
  /** Either additional adults or children — not both; each type has its own cap */
  additionalParticipants?: {
    when: { field: string; value: string };
    adultField: string;
    kidField: string;
    maxAdults: number;
    maxKids: number;
    messageBoth: string;
    messageNone: string;
    messageTooManyAdults: string;
    messageTooManyKids: string;
  };
  submitLabel?: string;
  /** Shown to verified users on the success page after submission */
  verifiedSuccess?: VerifiedSuccessInfo;
  /** If true, form is excluded from HomePage and AdminPage listings. Still reachable by direct URL. */
  hiddenFromListing?: boolean;
  /** If true, submit patches the user's existing sheet row instead of appending a new one. */
  updateExistingRegistration?: boolean;
}
