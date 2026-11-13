// pulse-orb: one breathing circle whose size and glow track your voice.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp } from "./types";

export function createPulseOrb(): EffectRenderer {
  let smooth = 0;
  return {
    init() {
      smooth = 0;
    },
    dispose() {},
    render(ctx, frame: EffectFrame) {
      smooth = lerp(smooth, frame.level, 0.15);
      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const breathe = frame.reducedMotion ? 0 : Math.sin(frame.time * 2) * 2;
      const r = 6 + smooth * (frame.height / 2 - 8) + breathe;

      // Halo ring.
      ctx.strokeStyle = frame.colors.accent;
      ctx.globalAlpha = 0.35 + smooth * 0.3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6 + smooth * 8, 0, Math.PI * 2);
      ctx.stroke();

      // Core orb.
      ctx.fillStyle = frame.colors.primary;
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = frame.colors.glow;
      ctx.shadowBlur = 12 + smooth * 24;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
  };
}
