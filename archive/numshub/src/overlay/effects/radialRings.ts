// radial-rings: rings burst outward from the center on speech peaks.

import type { EffectFrame, EffectRenderer } from "./types";

interface Ring {
  r: number;
  life: number;
  accent: boolean;
}

export function createRadialRings(): EffectRenderer {
  let rings: Ring[] = [];
  let cooldown = 0;
  return {
    init() {
      rings = [];
      cooldown = 0;
    },
    dispose() {
      rings = [];
    },
    render(ctx, frame: EffectFrame) {
      cooldown -= frame.dt;
      const threshold = frame.reducedMotion ? 0.5 : 0.25;
      if (frame.level > threshold && cooldown <= 0 && rings.length < 12) {
        rings.push({ r: 4, life: 1, accent: rings.length % 3 === 2 });
        cooldown = frame.reducedMotion ? 0.6 : 0.12;
      }
      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const maxR = Math.max(frame.width, frame.height) / 2;
      rings = rings.filter((ring) => ring.life > 0);
      for (const ring of rings) {
        ring.r += (30 + frame.level * 120) * frame.dt;
        ring.life -= frame.dt / (frame.reducedMotion ? 2.2 : 1.4);
        ctx.strokeStyle = ring.accent ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = Math.max(0, ring.life) * 0.8;
        ctx.lineWidth = 1.5 + ring.life * 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(ring.r, maxR), 0, Math.PI * 2);
        ctx.stroke();
      }
      // Quiet center dot so silence still shows presence.
      ctx.fillStyle = frame.colors.primary;
      ctx.globalAlpha = 0.5 + frame.level * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 + frame.level * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  };
}
