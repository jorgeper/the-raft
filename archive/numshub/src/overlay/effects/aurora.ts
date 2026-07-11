// aurora: soft layered light curtains that swell with your voice.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp } from "./types";

const LAYERS = 3;

export function createAurora(): EffectRenderer {
  let energy = 0;
  return {
    init() {
      energy = 0;
    },
    dispose() {},
    render(ctx, frame: EffectFrame) {
      energy = lerp(energy, frame.level, 0.08);
      const drift = frame.reducedMotion ? 0.15 : 0.7;
      for (let layer = 0; layer < LAYERS; layer++) {
        const f = layer / (LAYERS - 1);
        const baseY = frame.height * (0.35 + f * 0.3);
        const amp = (8 + energy * frame.height * 0.4) * (1 - f * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, frame.height);
        const points = 32;
        for (let i = 0; i <= points; i++) {
          const x = (i / points) * frame.width;
          const y =
            baseY +
            Math.sin(i * 0.35 + frame.time * drift * (1.2 + layer * 0.5)) * amp +
            Math.sin(i * 0.13 - frame.time * drift * 0.7) * amp * 0.5;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(frame.width, frame.height);
        ctx.closePath();
        ctx.fillStyle = layer === 1 ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = 0.14 + energy * 0.2;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
