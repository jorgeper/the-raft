// vu-needle: a classic analog meter — needle swings with your voice.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp } from "./types";

export function createVuNeedle(): EffectRenderer {
  let needle = 0;
  return {
    init() {
      needle = 0;
    },
    dispose() {},
    render(ctx, frame: EffectFrame) {
      // Needle ballistics: fast attack, slow release — the analog feel.
      const target = frame.level;
      needle = target > needle ? lerp(needle, target, 0.45) : lerp(needle, target, 0.06);

      const cx = frame.width / 2;
      const cy = frame.height - 4;
      const radius = Math.min(frame.width * 0.32, frame.height * 1.4);
      const start = Math.PI * 1.15;
      const end = Math.PI * 1.85;

      // Arc scale with tick marks; the hot end is accent-colored.
      for (let i = 0; i <= 10; i++) {
        const a = start + (end - start) * (i / 10);
        ctx.strokeStyle = i >= 8 ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = i % 5 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.lineTo(cx + Math.cos(a) * (radius - 7), cy + Math.sin(a) * (radius - 7));
        ctx.stroke();
      }

      // Needle.
      const angle = start + (end - start) * needle;
      ctx.strokeStyle = frame.colors.accent;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.shadowColor = frame.colors.glow;
      ctx.shadowBlur = 6 + needle * 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * (radius - 4), cy + Math.sin(angle) * (radius - 4));
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Pivot.
      ctx.fillStyle = frame.colors.primary;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  };
}
