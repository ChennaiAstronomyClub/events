import type { DiscourseUser } from "@/types/discourse";
import { DISCOURSE_URL } from "./env";

interface CurrentUserResponse {
  current_user: {
    id: number;
    username: string;
    name: string;
    trust_level: number;
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

export async function fetchFullUser(apiKey: string): Promise<DiscourseUser> {
  const { username } = await fetchCurrentUser(apiKey);
  return fetchUserProfile(username, apiKey);
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
