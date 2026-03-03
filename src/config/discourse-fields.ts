/**
 * Discourse configuration for group-based verification and custom field IDs.
 *
 * All values are sourced from validated env vars in `src/lib/env.ts`.
 */

export {
  VERIFIED_GROUP_NAME,
  PHONE_FIELD_ID,
  EMERGENCY_CONTACT_FIELD_ID,
  BLOOD_GROUP_FIELD_ID,
  AGE_GROUP_FIELD_ID,
} from "@/lib/env";

import { VERIFIED_GROUP_NAME } from "@/lib/env";

/** Check if a user belongs to the verified Discourse group */
export function isVerifiedUser(groups: { name: string }[]): boolean {
  return groups?.some((g) => g.name === VERIFIED_GROUP_NAME) ?? false;
}
