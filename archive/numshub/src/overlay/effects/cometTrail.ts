// comet-trail: a bright dot sweeps across; your voice stretches its tail.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp } from "./types";

export function createCometTrail(): EffectRenderer {
  let smooth = 0;
  return {
    init() {
      smooth = 0;
    },
    dispose() {},
    render(ctx, frame: EffectFrame) {
      smooth = lerp(smooth, frame.level, 0.12);
      const speed = frame.reducedMotion ? 0.08 : 0.35;
      const t = (frame.time * speed) % 1;
      const cy = frame.height / 2;
      const headX = t * (frame.width + 80) - 40;
      const tail = 20 + smooth * 140;
      const steps = 18;
      for (let i = steps; i >= 0; i--) {
        const f = i / steps;
        const x = headX - f * tail;
        const wobble = frame.reducedMotion ? 0 : Math.sin(frame.time * 8 + f * 6) * smooth * 8;
        ctx.fillStyle = i === 0 ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = (1 - f) * (0.25 + smooth * 0.7);
        ctx.beginPath();
        ctx.arc(x, cy + wobble, i === 0 ? 4 + smooth * 3 : 2.5 * (1 - f) + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
  };
}
