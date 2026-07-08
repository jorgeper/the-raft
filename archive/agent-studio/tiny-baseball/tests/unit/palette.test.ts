// U6 — SPEC §4.2: the retro palette module exports at most 24 unique hex
// colors, and every hex color literal used in src/render/*.ts comes from it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE } from '../../src/render/palette';

const RENDER_DIR = fileURLToPath(new URL('../../src/render', import.meta.url));

describe('U6: palette discipline', () => {
  it('palette has at most 24 unique hex colors, all well-formed', () => {
    const values = Object.values(PALETTE);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeLessThanOrEqual(24);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('every hex literal in src/render/*.ts is a palette color', () => {
    const allowed = new Set(Object.values(PALETTE).map((v) => v.toLowerCase()));
    const files = readdirSync(RENDER_DIR).filter(
      (f) => f.endsWith('.ts') && f !== 'palette.ts',
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(RENDER_DIR, f), 'utf8');
      const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      for (const h of hexes) {
        expect(allowed, `${f} uses off-palette color ${h}`).toContain(h.toLowerCase());
      }
    }
  });
});
