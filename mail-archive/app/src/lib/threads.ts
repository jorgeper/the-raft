// Small in-memory thread cache (promises, so concurrent loads share one call).
import { getThread, type MessageView, type ThreadId } from "./api";

const MAX = 8;
const cache = new Map<string, Promise<MessageView[]>>();

const keyOf = (thrid: ThreadId, terms: string[]) => `${thrid}\u0000${terms.join("\u0000")}`;

export function loadThread(thrid: ThreadId, terms: string[]): Promise<MessageView[]> {
  const key = keyOf(thrid, terms);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // refresh recency
    cache.set(key, hit);
    return hit;
  }
  const p = getThread(thrid, terms);
  cache.set(key, p);
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return p;
}

export function prefetchThread(thrid: ThreadId, terms: string[]): void {
  loadThread(thrid, terms).catch(() => {});
}

export function clearThreadCache(): void {
  cache.clear();
}

export function cachedThreadCount(): number {
  return cache.size;
}
