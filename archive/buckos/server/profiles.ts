import type { Repo } from './repo';

/**
 * Parent profiles (display name + avatar). Parents live in the env allowlist,
 * not in a table, so their editable profile bits are stored as JSON in the
 * settings table keyed by email.
 */
export interface Profile {
  name: string | null;
  avatar: string | null;
}

const key = (email: string) => `profile:${email.trim().toLowerCase()}`;

export function getProfile(repo: Repo, email: string): Profile {
  const raw = repo.getSetting(key(email));
  if (!raw) return { name: null, avatar: null };
  try {
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return { name: parsed.name ?? null, avatar: parsed.avatar ?? null };
  } catch {
    return { name: null, avatar: null };
  }
}

export function setProfile(repo: Repo, email: string, profile: Profile): void {
  repo.setSetting(key(email), JSON.stringify(profile));
}

/** True for a small square-cropped image data URL (or null = no photo). */
export function isValidAvatar(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.startsWith('data:image/') && value.length <= 500_000);
}
