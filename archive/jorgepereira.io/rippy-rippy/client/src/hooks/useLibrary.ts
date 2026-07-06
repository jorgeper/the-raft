import { useEffect, useState } from 'react';
import { getLibrary } from '../api';
import type { Library, LibraryExercise } from '../types';

let cached: Library | null = null;
let pending: Promise<Library> | null = null;

function fetchLibrary(): Promise<Library> {
  if (cached) return Promise.resolve(cached);
  pending ??= getLibrary().then(({ library }) => {
    cached = library;
    pending = null;
    return library;
  });
  return pending;
}

/** The global exercise library, fetched once per session. */
export function useLibrary(): Library | null {
  const [library, setLibrary] = useState<Library | null>(cached);
  useEffect(() => {
    if (!library) void fetchLibrary().then(setLibrary).catch(() => {});
  }, [library]);
  return library;
}

export function findLibraryExercise(library: Library | null, name: string): LibraryExercise | null {
  if (!library) return null;
  const lower = name.trim().toLowerCase();
  return library.exercises.find((e) => e.name.toLowerCase() === lower) ?? null;
}
