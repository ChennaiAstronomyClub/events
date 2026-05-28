import type { DiscourseUser } from "@/types/discourse";
import { DISCOURSE_URL } from "./env";

interface CurrentUserResponse {
  current_user: {
    id: number;
    username: string;
    name: string;
    trust_level: number;
    email?: string;
    groups?: { id: number; name: string; display_name?: string }[];
  };
}

interface UserProfileResponse {
  user: {
    id: number;
    username: string;
    name: string;
    email: string;
    avatar_template: string;
    trust_level: number;
    bio_raw: string;
    user_fields: Record<string, string>;
    groups: { id: number; name: string; display_name?: string }[];
  };
}

async function discourseGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${DISCOURSE_URL}${path}`, {
    headers: {
      "User-Api-Key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Discourse API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchCurrentUser(apiKey: string): Promise<{ username: string }> {
  const data = await discourseGet<CurrentUserResponse>("/session/current.json", apiKey);
  return { username: data.current_user.username };
}

export async function fetchUserProfile(
  username: string,
  apiKey: string
): Promise<DiscourseUser> {
  const data = await discourseGet<UserProfileResponse>(`/u/${username}.json`, apiKey);
  return data.user;
}

/**
 * Load the logged-in user. Uses session/current only when email + groups are present;
 * otherwise falls back to one profile fetch (two round-trips total).
 */
export async function fetchFullUser(apiKey: string): Promise<DiscourseUser> {
  const session = await discourseGet<CurrentUserResponse>("/session/current.json", apiKey);
  const cu = session.current_user;
  if (cu.email) {
    return {
      id: cu.id,
      username: cu.username,
      name: cu.name,
      email: cu.email,
      avatar_template: "",
      trust_level: cu.trust_level,
      bio_raw: "",
      user_fields: {},
      groups: Array.isArray(cu.groups) ? cu.groups : [],
    };
  }
  return fetchUserProfile(cu.username, apiKey);
}

/**
 * Update custom user fields on the user's Discourse profile.
 * Takes a map of field IDs to values, e.g. { "2": "9876543210", "3": "John - 555-1234" }
 */
export async function updateUserFields(
  username: string,
  apiKey: string,
  userFields: Record<string, string>
): Promise<void> {
  const response = await fetch(`${DISCOURSE_URL}/u/${username}.json`, {
    method: "PUT",
    headers: {
      "User-Api-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ user_fields: userFields }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update profile: ${response.status} ${response.statusText}`);
  }
}
