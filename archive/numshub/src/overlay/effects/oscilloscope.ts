// oscilloscope: one smooth glowing line tracing the level history.

import type { EffectFrame, EffectRenderer } from "./types";

export function createOscilloscope(): EffectRenderer {
  return {
    init() {},
    dispose() {},
    render(ctx, frame: EffectFrame) {
      const mid = frame.height / 2;
      const n = Math.max(2, frame.levels.length);
      const usable = frame.width;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const level = frame.levels[i] ?? 0;
        const phase = frame.reducedMotion ? 0 : frame.time * 6;
        const y = mid + Math.sin(i * 0.5 + phase) * level * mid * 0.85;
        const x = (i / (n - 1)) * usable;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = frame.colors.primary;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.shadowColor = frame.colors.glow;
      ctx.shadowBlur = 8 + frame.level * 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Baseline tick at the current level, oscilloscope style.
      ctx.fillStyle = frame.colors.accent;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(frame.width - 3, mid - frame.level * mid * 0.85 - 1.5, 3, 3);
      ctx.globalAlpha = 1;
    },
  };
}
