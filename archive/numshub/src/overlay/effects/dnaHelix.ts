// dna-helix: two twisting strands; your voice widens and speeds the helix.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp } from "./types";

export function createDnaHelix(): EffectRenderer {
  let amp = 0;
  return {
    init() {
      amp = 0;
    },
    dispose() {},
    render(ctx, frame: EffectFrame) {
      amp = lerp(amp, 0.25 + frame.level * 0.75, 0.1);
      const mid = frame.height / 2;
      const spin = frame.reducedMotion ? frame.time * 0.6 : frame.time * 2.4 + frame.level * 3;
      const points = 46;
      const stepX = frame.width / (points - 1);
      const maxAmp = mid * 0.8 * amp;

      for (let strand = 0; strand < 2; strand++) {
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
          const phase = i * 0.42 + spin + strand * Math.PI;
          const y = mid + Math.sin(phase) * maxAmp;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * stepX, y);
        }
        ctx.strokeStyle = strand === 0 ? frame.colors.primary : frame.colors.accent;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Base-pair rungs where the strands cross widest.
      for (let i = 0; i < points; i += 4) {
        const phase = i * 0.42 + spin;
        const y1 = mid + Math.sin(phase) * maxAmp;
        const y2 = mid + Math.sin(phase + Math.PI) * maxAmp;
        ctx.strokeStyle = frame.colors.primary;
        ctx.globalAlpha = 0.3 + frame.level * 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(i * stepX, y1);
        ctx.lineTo(i * stepX, y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
