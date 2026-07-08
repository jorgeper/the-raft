import { DEFAULT_HOTKEYS, type HotkeyMap } from './hotkeys';

export type CommentStorage = 'sidecar' | 'embedded';
export type Margins = 'default' | 'narrow' | 'medium' | 'wide';

export const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;

/** Margin presets → content-column max-width overrides (SPEC3 §2). */
export const MARGIN_WIDTHS: Record<Exclude<Margins, 'default'>, string> = {
  narrow: '60rem',
  medium: '48rem',
  wide: '38rem',
};

/** Persisted app settings (settings.json in the app config dir, pretty-printed). */
export interface Settings {
  themeLight: string;
  themeDark: string;
  useDarkTheme: boolean;
  fontSize: 'auto' | number;
  zoom: number;
  margins: Margins;
  lineNumbers: boolean;
  vimNav: boolean;
  author: string;
  autosaveOnToggle: boolean;
  commentStorage: CommentStorage;
  hotkeys: HotkeyMap;
}

export const DEFAULT_SETTINGS: Settings = {
  themeLight: 'crisp',
  themeDark: 'one-dark',
  useDarkTheme: true,
  fontSize: 'auto',
  zoom: 100,
  margins: 'default',
  lineNumbers: true,
  vimNav: false,
  author: 'Reviewer',
  autosaveOnToggle: false,
  commentStorage: 'sidecar',
  hotkeys: { ...DEFAULT_HOTKEYS },
};

/** Parse settings.json text; unknown/missing/malformed fields fall back to defaults. */
export function parseSettings(json: string): Settings {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } };
  }
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const hk = (typeof o.hotkeys === 'object' && o.hotkeys !== null ? o.hotkeys : {}) as Record<string, unknown>;
  const hotkeys: HotkeyMap = { ...DEFAULT_HOTKEYS };
  for (const k of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
    if (typeof hk[k] === 'string' && (hk[k] as string).trim()) hotkeys[k] = hk[k] as string;
  }
  // Migration: pre-v3 settings stored a single `theme` key.
  const legacyTheme = typeof o.theme === 'string' && o.theme ? o.theme : null;

  let fontSize: 'auto' | number = 'auto';
  if (typeof o.fontSize === 'number' && o.fontSize >= FONT_SIZE_MIN && o.fontSize <= FONT_SIZE_MAX) {
    fontSize = Math.round(o.fontSize);
  }

  const zoom =
    typeof o.zoom === 'number' && (ZOOM_LEVELS as readonly number[]).includes(o.zoom)
      ? o.zoom
      : DEFAULT_SETTINGS.zoom;

  const margins: Margins =
    o.margins === 'narrow' || o.margins === 'medium' || o.margins === 'wide' ? o.margins : 'default';

  return {
    themeLight:
      typeof o.themeLight === 'string' && o.themeLight
        ? o.themeLight
        : (legacyTheme ?? DEFAULT_SETTINGS.themeLight),
    themeDark: typeof o.themeDark === 'string' && o.themeDark ? o.themeDark : DEFAULT_SETTINGS.themeDark,
    useDarkTheme: typeof o.useDarkTheme === 'boolean' ? o.useDarkTheme : DEFAULT_SETTINGS.useDarkTheme,
    fontSize,
    zoom,
    margins,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULT_SETTINGS.lineNumbers,
    vimNav: o.vimNav === true,
    author: typeof o.author === 'string' && o.author ? o.author : DEFAULT_SETTINGS.author,
    autosaveOnToggle: o.autosaveOnToggle === true,
    commentStorage: o.commentStorage === 'embedded' ? 'embedded' : 'sidecar',
    hotkeys,
  };
}

export function serializeSettings(s: Settings): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
