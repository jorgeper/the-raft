import { useEffect, useSyncExternalStore } from 'react';
import { getSettings, putSettings } from '../api';
import type { UserSettings } from '../types';

/** Tiny shared store so the unit/dev-mode setting is consistent across screens. */

const DEFAULTS: UserSettings = { weightUnit: 'lb', devMode: false };

let cache: UserSettings | null = null;
let fetching = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): UserSettings {
  return cache ?? DEFAULTS;
}

async function ensureLoaded() {
  if (cache || fetching) return;
  fetching = true;
  try {
    cache = (await getSettings()).settings;
    notify();
  } finally {
    fetching = false;
  }
}

export async function updateSettings(next: UserSettings): Promise<void> {
  cache = next; // optimistic
  notify();
  cache = (await putSettings(next)).settings;
  notify();
}

/** Reset the cache on logout so the next user doesn't see stale settings. */
export function clearSettingsCache() {
  cache = null;
  notify();
}

export function useSettings(): UserSettings {
  const settings = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    void ensureLoaded();
  }, []);
  return settings;
}
