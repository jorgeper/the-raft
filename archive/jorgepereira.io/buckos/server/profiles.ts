import type { Repo } from './repo';

/**
 * Parent profiles (display name + avatar). Parents live in the env allowlist,
 * not in a table, so their editable profile bits are stored as JSON in the
 * settings table keyed by email.
 */
export interface Profile {
  name: string | null;
  avatar: string | null; // app-set photo — always wins
  googlePicture: string | null; // Google account photo, refreshed at sign-in
}

const key = (email: string) => `profile:${email.trim().toLowerCase()}`;

export function getProfile(repo: Repo, email: string): Profile {
  const raw = repo.getSetting(key(email));
  if (!raw) return { name: null, avatar: null, googlePicture: null };
  try {
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return { name: parsed.name ?? null, avatar: parsed.avatar ?? null, googlePicture: parsed.googlePicture ?? null };
  } catch {
    return { name: null, avatar: null, googlePicture: null };
  }
}

export function setProfile(repo: Repo, email: string, profile: Profile): void {
  repo.setSetting(key(email), JSON.stringify(profile));
}

/** True for a small square-cropped image data URL (or null = no photo). */
export function isValidAvatar(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.startsWith('data:image/') && value.length <= 500_000);
}

/**
 * Remember the Google account photo seen at sign-in so it can serve as the
 * default picture. The app-set avatar, when present, always wins over it.
 */
export function recordGooglePicture(
  repo: Repo,
  user: { role: 'parent' | 'kid'; email: string; kidId?: number },
  picture: unknown
): void {
  const url = typeof picture === 'string' && picture.startsWith('https://') ? picture : null;
  if (user.role === 'parent') {
    setProfile(repo, user.email, { ...getProfile(repo, user.email), googlePicture: url });
  } else if (user.kidId !== undefined) {
    repo.updateKid(user.kidId, { googlePicture: url });
  }
}
