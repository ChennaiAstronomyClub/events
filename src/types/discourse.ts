export interface DiscourseGroup {
  id: number;
  name: string;
  display_name?: string;
}

export interface DiscourseUser {
  id: number;
  username: string;
  name: string;
  email: string;
  avatar_template: string;
  trust_level: number;
  bio_raw: string;
  user_fields: Record<string, string>;
  groups: DiscourseGroup[];
}

export interface DiscourseAuthPayload {
  key: string;
  nonce: string;
  push: boolean;
  api: number;
}
