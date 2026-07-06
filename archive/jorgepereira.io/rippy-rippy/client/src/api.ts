import type {
  DayRecord,
  DaySummary,
  DevUser,
  ExerciseStat,
  HistoryPoint,
  Library,
  PersonalRecord,
  SavedWorkout,
  SessionUser,
  Suggestion,
  UserSettings,
  WorkoutStats,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Auth ---
export const getMe = () => http<{ user: SessionUser | null }>('GET', '/api/me');
export const getAuthMode = () => http<{ mode: 'dev' | 'google' }>('GET', '/api/auth/mode');
export const getDevUsers = () => http<{ users: DevUser[] }>('GET', '/api/auth/dev-users');
export const devLogin = (email: string) => http<{ user: unknown }>('POST', '/api/auth/dev-login', { email });
export const logout = () => http<void>('POST', '/api/auth/logout');

// --- Days ---
export const getDaySummaries = (from: string, to: string) =>
  http<{ days: DaySummary[] }>('GET', `/api/days?from=${from}&to=${to}`);
export const getDay = async (date: string): Promise<DayRecord | null> => {
  try {
    const { day } = await http<{ day: DayRecord }>('GET', `/api/days/${date}`);
    return day;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
};
export const putDay = (day: DayRecord) => http<{ day: DayRecord }>('PUT', `/api/days/${day.date}`, day);
export const getExerciseStats = (date: string, names: string[]) =>
  http<{ stats: Record<string, ExerciseStat> }>(
    'GET',
    `/api/exercise-stats?date=${date}&names=${encodeURIComponent(names.join(','))}`
  );
export const getSuggestions = (date: string) =>
  http<{ suggestions: Suggestion[] }>('GET', `/api/suggestions?date=${date}`);
export const getAnalytics = () =>
  http<{ stats: WorkoutStats; records: PersonalRecord[]; exerciseNames: string[] }>('GET', '/api/analytics');
export const getHistory = (names: string[]) =>
  http<{ history: Record<string, HistoryPoint[]> }>(
    'GET',
    `/api/history?names=${encodeURIComponent(names.join(','))}`
  );

// --- Saved workouts ---
export const getWorkouts = () => http<{ workouts: SavedWorkout[] }>('GET', '/api/workouts');
export const saveWorkout = (name: string, exercises: string[]) =>
  http<{ workout: SavedWorkout }>('POST', '/api/workouts', { name, exercises });
export const updateWorkout = (id: number, name: string, exercises: string[]) =>
  http<{ workout: SavedWorkout }>('PUT', `/api/workouts/${id}`, { name, exercises });
export const deleteWorkout = (id: number) => http<void>('DELETE', `/api/workouts/${id}`);

// --- Settings & profile ---
export const getSettings = () => http<{ settings: UserSettings }>('GET', '/api/settings');
export const putSettings = (settings: UserSettings) =>
  http<{ settings: UserSettings }>('PUT', '/api/settings', settings);
export const putProfile = (patch: { name?: string; avatar?: string | null; useGooglePhoto?: boolean }) =>
  http<{ user: SessionUser & { hasCustomAvatar: boolean } }>('PUT', '/api/profile', patch);
export const getProfile = () =>
  http<{ profile: { email: string; name: string; customAvatar: string | null; googlePicture: string | null } }>(
    'GET',
    '/api/profile'
  );

// --- Library ---
export const getLibrary = () => http<{ library: Library }>('GET', '/api/library');

// --- Data ---
export const importData = (payload: unknown) =>
  http<{
    result: { daysImported: number; daysSkipped: number; workoutsImported: number; workoutsSkipped: number };
  }>('POST', '/api/import', payload);

// --- Dev tools ---
export const devGenerateDays = (startDate: string, count: number) =>
  http<{ generated: number }>('POST', '/api/dev/generate-days', { startDate, count });
export const devGenerateWorkouts = () => http<{ added: number }>('POST', '/api/dev/generate-workouts');
export const devReset = () => http<void>('POST', '/api/dev/reset');
