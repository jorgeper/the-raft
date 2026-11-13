// U8: the effect registry (SPEC6 §6) — 15 renderers, one interface, theme
// colors required everywhere (no hardcoded draw colors at the source level).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECT, EFFECTS, getEffect } from "../../src/overlay/effects";
import type { EffectFrame } from "../../src/overlay/effects/types";

const DRAW_CALLS = new Set(["fill", "stroke", "fillRect", "strokeRect", "fillText"]);

function stubContext() {
  const drawCalls: string[] = [];
  const target: Record<string, unknown> = {
    canvas: {},
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getTransform: () => ({}),
  };
  const ctx = new Proxy(target, {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      return (...args: unknown[]) => {
        void args;
        if (DRAW_CALLS.has(prop)) drawCalls.push(prop);
      };
    },
    set(obj, prop: string, value) {
      obj[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawCalls };
}

function frame(overrides: Partial<EffectFrame> = {}): EffectFrame {
  return {
    level: 0.7,
    levels: Array.from({ length: 40 }, (_, i) => (i % 10) / 10),
    time: 1.2,
    dt: 0.016,
    colors: { primary: "sentinel-primary", accent: "sentinel-accent", glow: "sentinel-glow" },
    reducedMotion: false,
    width: 200,
    height: 34,
    ...overrides,
  };
}

describe("U8: effect registry", () => {
  it("has exactly 15 effects with unique ids and the default present", () => {
    expect(EFFECTS).toHaveLength(15);
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(15);
    expect(ids).toContain(DEFAULT_EFFECT);
  });

  it("unknown ids fall back to the default effect", () => {
    expect(getEffect("does-not-exist").id).toBe(DEFAULT_EFFECT);
  });

  for (const def of EFFECTS) {
    it(`${def.id}: implements the interface and draws without throwing`, () => {
      const renderer = def.create();
      expect(typeof renderer.init).toBe("function");
      expect(typeof renderer.render).toBe("function");
      expect(typeof renderer.dispose).toBe("function");

      const { ctx, drawCalls } = stubContext();
      renderer.init(ctx, 200, 34);
      for (let i = 0; i < 10; i++) {
        renderer.render(ctx, frame({ time: i * 0.033, level: (i % 5) / 5 }));
      }
      expect(drawCalls.length).toBeGreaterThan(0);

      // Reduced motion and empty history must be safe too.
      renderer.render(ctx, frame({ reducedMotion: true, levels: [], level: 0 }));
      renderer.dispose();
    });
  }

  it("no effect module hardcodes draw colors — themes own every color", () => {
    // Vitest runs from the project root.
    const dir = join(process.cwd(), "src/overlay/effects");
    const modules = readdirSync(dir).filter(
      (f: string) => f.endsWith(".ts") && !["index.ts", "types.ts", "engine.ts"].includes(f),
    );
    expect(modules.length).toBe(15);
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|blue|green|cyan|magenta|yellow|orange|purple)\b/;
    for (const file of modules) {
      const source = readFileSync(join(dir, file), "utf8");
      // Strip comments before scanning; prose may mention colors.
      const code = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(colorLiteral.test(code), `${file} must not hardcode colors`).toBe(false);
    }
  });
});
