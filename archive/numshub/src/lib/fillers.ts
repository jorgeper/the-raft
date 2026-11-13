// Filler-word list editing logic (U4) — pure functions behind the chips UI.

import { DEFAULT_FILLERS } from "../ipc/types";

/** Normalize then add; rejects empties, multi-word entries, and duplicates. */
export function addFiller(list: string[], word: string): string[] {
  const normalized = word.trim().toLowerCase();
  if (!normalized || /\s/.test(normalized)) return list;
  if (list.includes(normalized)) return list;
  return [...list, normalized];
}

export function removeFiller(list: string[], word: string): string[] {
  return list.filter((w) => w !== word);
}

export function resetFillers(): string[] {
  return [...DEFAULT_FILLERS];
}
