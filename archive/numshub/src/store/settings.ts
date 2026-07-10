// Minimal observable settings store (U1). Pure state container — IPC wiring
// lives in the components so this is trivially unit-testable.

import type { Settings } from "../ipc/types";
import { defaultSettings } from "../ipc/types";

export type Listener = (settings: Settings) => void;

export interface SettingsStore {
  get(): Settings;
  /** Shallow-merge a partial update (nested objects replaced wholesale). */
  update(partial: Partial<Settings>): Settings;
  replace(settings: Settings): void;
  subscribe(listener: Listener): () => void;
}

export function createSettingsStore(initial?: Settings): SettingsStore {
  let state: Settings = initial ? structuredClone(initial) : defaultSettings();
  const listeners = new Set<Listener>();

  const notify = () => listeners.forEach((l) => l(state));

  return {
    get: () => state,
    update(partial) {
      state = { ...state, ...structuredClone(partial) };
      notify();
      return state;
    },
    replace(settings) {
      state = structuredClone(settings);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
