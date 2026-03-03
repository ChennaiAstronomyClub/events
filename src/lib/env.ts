/**
 * Validated environment variables.
 *
 * All VITE_* env vars are embedded in the client bundle at build time.
 * This module validates them once on import so the rest of the app can
 * trust that required values are present and well-formed.
 */

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value || typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optionalEnv(key: string, fallback: string = ""): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/** Discourse forum URL (no trailing slash) */
export const DISCOURSE_URL = requireEnv("VITE_DISCOURSE_URL").replace(/\/+$/, "");

/** This app's public URL (used for auth redirect) */
export const APP_URL = requireEnv("VITE_APP_URL").replace(/\/+$/, "");

/** Display name shown on the Discourse auth prompt */
export const APP_NAME = optionalEnv("VITE_APP_NAME", "CAC Forms");

/** Discourse group name whose members are considered "verified" */
export const VERIFIED_GROUP_NAME = optionalEnv("VITE_VERIFIED_GROUP_NAME", "verified-members");

/** Google Apps Script web-app URL */
export const APPS_SCRIPT_URL = requireEnv("VITE_APPS_SCRIPT_URL");

/** Shared secret for the Apps Script proxy */
export const SHEETS_SECRET = requireEnv("VITE_SHEETS_SECRET");

/** Optional Google Form URL shown to non-members */
export const GOOGLE_FORM_URL = optionalEnv("VITE_GOOGLE_FORM_URL");

/** Discourse custom user-field IDs */
export const PHONE_FIELD_ID = optionalEnv("VITE_PHONE_FIELD_ID", "2");
export const EMERGENCY_CONTACT_FIELD_ID = optionalEnv("VITE_EMERGENCY_CONTACT_FIELD_ID", "3");
export const BLOOD_GROUP_FIELD_ID = optionalEnv("VITE_BLOOD_GROUP_FIELD_ID", "4");
export const AGE_GROUP_FIELD_ID = optionalEnv("VITE_AGE_GROUP_FIELD_ID", "5");
