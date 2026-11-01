/**
 * Panel settings that survive a reload. Each bound object's listed properties are restored from `localStorage`
 * when bound, saved on `save()`, and put back to the values they had at bind time on `reset()`.
 * Storage can be missing or throw (private windows, blocked site data); the page then just runs on defaults.
 */
type Value = number | boolean | string;
type Bag = Record<string, Value>;

const KEY = 'meadows.settings.v1';

export class Persist {
  private entries = new Map<string, { obj: Record<string, unknown>; props: string[]; defaults: Bag }>();
  private stored: Record<string, Bag> = {};

  /** With `enabled = false` (the `?defaults` URL flag) nothing is read or written, so scripted shots start clean. */
  constructor(private enabled = true) {
    if (!enabled) return;
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') this.stored = parsed;
    } catch {
      this.stored = {};
    }
  }

  /** Remembers the current values of `props` as defaults, then overwrites them with any stored values. */
  bind<T extends object>(key: string, obj: T, props: (keyof T & string)[]) {
    const target = obj as Record<string, unknown>;
    const defaults: Bag = {};
    for (const p of props) defaults[p] = target[p] as Value;
    this.entries.set(key, { obj: target, props, defaults });
    const saved = this.stored[key];
    if (!saved || typeof saved !== 'object') return;
    for (const p of props) {
      // Only accept a stored value of the same type as the default, so a stale or hand-edited store can't break things.
      if (p in saved && typeof saved[p] === typeof defaults[p]) target[p] = saved[p];
    }
  }

  save() {
    if (!this.enabled) return;
    const out: Record<string, Bag> = {};
    for (const [key, { obj, props }] of this.entries) {
      out[key] = {};
      for (const p of props) out[key][p] = obj[p] as Value;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* storage full or blocked: settings just won't persist */
    }
  }

  /** Restores every bound property to its default and forgets the stored copy. */
  reset() {
    for (const { obj, defaults } of this.entries.values()) Object.assign(obj, defaults);
    this.stored = {};
    if (!this.enabled) return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
