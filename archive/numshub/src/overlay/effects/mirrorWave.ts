// mirror-wave: symmetric bars breathing outward from the midline.

import type { EffectFrame, EffectRenderer } from "./types";

const BAR_W = 3;
const GAP = 2;

export function createMirrorWave(): EffectRenderer {
  return {
    init() {},
    dispose() {},
    render(ctx, frame: EffectFrame) {
      const count = Math.floor(frame.width / (BAR_W + GAP));
      const recent = frame.levels.slice(-count);
      const pad = count - recent.length;
      const mid = frame.height / 2;
      for (let i = 0; i < count; i++) {
        const level = i < pad ? 0 : recent[i - pad];
        const wobble = frame.reducedMotion ? 0 : Math.sin(frame.time * 3 + i * 0.4) * 0.08;
        const h = Math.max(1.5, (level + wobble * level) * mid * 0.92);
        const x = i * (BAR_W + GAP);
        ctx.fillStyle = frame.colors.primary;
        ctx.globalAlpha = 0.45 + level * 0.55;
        ctx.fillRect(x, mid - h, BAR_W, h);
        ctx.fillStyle = frame.colors.accent;
        ctx.globalAlpha = 0.3 + level * 0.4;
        ctx.fillRect(x, mid, BAR_W, h);
      }
      ctx.globalAlpha = 1;
    },
  };
}
