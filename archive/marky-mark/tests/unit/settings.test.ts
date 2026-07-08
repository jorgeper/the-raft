import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from '../../src/lib/settings';

describe('v3 settings', () => {
  test('U13: new fields parse with defaults, invalid values fall back, legacy `theme` migrates to themeLight', () => {
    // Empty/malformed input → full defaults.
    const d = parseSettings('{}');
    expect(d.themeLight).toBe('crisp');
    expect(d.themeDark).toBe('one-dark');
    expect(d.useDarkTheme).toBe(true);
    expect(d.fontSize).toBe('auto');
    expect(d.zoom).toBe(100);
    expect(d.margins).toBe('default');
    expect(d.lineNumbers).toBe(true);
    expect(d.vimNav).toBe(false);
    expect(parseSettings('not json')).toEqual({ ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } });

    // Legacy v1/v2 file: single `theme` key migrates to themeLight.
    const legacy = parseSettings('{"theme":"monokai","author":"Jorge"}');
    expect(legacy.themeLight).toBe('monokai');
    expect(legacy.themeDark).toBe('one-dark');
    expect(legacy.author).toBe('Jorge');

    // An explicit themeLight wins over a stale legacy key.
    expect(parseSettings('{"theme":"monokai","themeLight":"nord"}').themeLight).toBe('nord');

    // Valid custom values round-trip through serialize → parse.
    const custom = parseSettings(
      serializeSettings({
        ...DEFAULT_SETTINGS,
        themeLight: 'claude',
        themeDark: 'dracula',
        useDarkTheme: false,
        fontSize: 20,
        zoom: 150,
        margins: 'wide',
        lineNumbers: false,
        vimNav: true,
      })
    );
    expect(custom.themeLight).toBe('claude');
    expect(custom.themeDark).toBe('dracula');
    expect(custom.useDarkTheme).toBe(false);
    expect(custom.fontSize).toBe(20);
    expect(custom.zoom).toBe(150);
    expect(custom.margins).toBe('wide');
    expect(custom.lineNumbers).toBe(false);
    expect(custom.vimNav).toBe(true);

    // Out-of-range / unknown values fall back.
    expect(parseSettings('{"fontSize":8}').fontSize).toBe('auto'); // below min 10
    expect(parseSettings('{"fontSize":99}').fontSize).toBe('auto'); // above max 32
    expect(parseSettings('{"fontSize":"big"}').fontSize).toBe('auto');
    expect(parseSettings('{"zoom":137}').zoom).toBe(100); // not a preset level
    expect(parseSettings('{"margins":"gigantic"}').margins).toBe('default');
    expect(parseSettings('{"lineNumbers":"yes"}').lineNumbers).toBe(true);
  });
});
