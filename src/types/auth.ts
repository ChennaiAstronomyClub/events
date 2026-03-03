import type { DiscourseUser } from "./discourse";

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: DiscourseUser | null;
  apiKey: string | null;
  error: string | null;
}
