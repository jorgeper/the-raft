// glitch-bars: level bars with digital jitter and displaced slices on peaks.

import type { EffectFrame, EffectRenderer } from "./types";
import { mulberry } from "./types";

const BAR_W = 4;
const GAP = 2;

export function createGlitchBars(): EffectRenderer {
  const rand = mulberry(2077);
  return {
    init() {},
    dispose() {},
    render(ctx, frame: EffectFrame) {
      const count = Math.floor(frame.width / (BAR_W + GAP));
      const recent = frame.levels.slice(-count);
      const pad = count - recent.length;
      const glitchy = !frame.reducedMotion && frame.level > 0.45;

      for (let i = 0; i < count; i++) {
        const level = i < pad ? 0 : recent[i - pad];
        const h = Math.max(2, level * (frame.height - 4));
        let x = i * (BAR_W + GAP);
        let y = (frame.height - h) / 2;
        const isGlitch = glitchy && rand() < 0.18;
        if (isGlitch) {
          x += (rand() - 0.5) * 8;
          y += (rand() - 0.5) * 6;
        }
        ctx.fillStyle = isGlitch ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = isGlitch ? 0.95 : 0.5 + level * 0.5;
        ctx.fillRect(x, y, BAR_W, h);
        // Chromatic echo: a faint displaced copy of glitched bars.
        if (isGlitch) {
          ctx.globalAlpha = 0.3;
          ctx.fillRect(x + 3, y - 2, BAR_W, h);
        }
      }
      // Horizontal scan tear on hard peaks.
      if (glitchy && rand() < 0.3) {
        const ty = rand() * frame.height;
        ctx.fillStyle = frame.colors.accent;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(0, ty, frame.width, 1.5);
      }
      ctx.globalAlpha = 1;
    },
  };
}
