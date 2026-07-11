// classic-bars: the original look — level history as rounded bars, newest right.

import type { EffectFrame, EffectRenderer } from "./types";

const BAR_W = 3;
const GAP = 3;

export function createClassicBars(): EffectRenderer {
  return {
    init() {},
    dispose() {},
    render(ctx, frame: EffectFrame) {
      const count = Math.floor(frame.width / (BAR_W + GAP));
      const recent = frame.levels.slice(-count);
      const pad = count - recent.length;
      ctx.fillStyle = frame.colors.primary;
      for (let i = 0; i < count; i++) {
        const level = i < pad ? 0 : recent[i - pad];
        const h = Math.max(3, level * (frame.height - 6));
        const x = i * (BAR_W + GAP);
        const y = (frame.height - h) / 2;
        ctx.globalAlpha = 0.55 + level * 0.45;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_W, h, BAR_W / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
