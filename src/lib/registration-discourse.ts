import type { DiscourseUser } from "@/types/discourse";
import { storage } from "@/lib/storage";

/** Snapshot sent with /api/registrations so the server can skip a profile fetch. */
export interface RegistrationDiscourseUser {
  username: string;
  email: string;
  groups: string[];
}

export function getRegistrationDiscourseUser(
  user?: DiscourseUser | null
): RegistrationDiscourseUser | undefined {
  const resolved = user ?? storage.getUser<DiscourseUser>();
  if (!resolved?.username?.trim() || !resolved?.email?.trim()) return undefined;
  return {
    username: resolved.username.trim(),
    email: resolved.email.trim(),
    groups: Array.isArray(resolved.groups)
      ? resolved.groups.map((g) => g.name).filter(Boolean)
      : [],
  };
}
