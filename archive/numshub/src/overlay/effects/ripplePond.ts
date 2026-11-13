// ripple-pond: raindrop ripples land across the pond when you speak.

import type { EffectFrame, EffectRenderer } from "./types";
import { mulberry } from "./types";

interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
}

export function createRipplePond(): EffectRenderer {
  const rand = mulberry(7);
  let ripples: Ripple[] = [];
  let cooldown = 0;
  return {
    init() {
      ripples = [];
      cooldown = 0;
    },
    dispose() {
      ripples = [];
    },
    render(ctx, frame: EffectFrame) {
      cooldown -= frame.dt;
      const rate = frame.reducedMotion ? 0.5 : 0.1;
      if (frame.level > 0.15 && cooldown <= 0 && ripples.length < 14) {
        ripples.push({
          x: rand() * frame.width,
          y: frame.height * (0.3 + rand() * 0.4),
          r: 2,
          life: 1,
        });
        cooldown = rate + (1 - frame.level) * 0.3;
      }
      // Still water line.
      ctx.strokeStyle = frame.colors.primary;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, frame.height / 2);
      ctx.lineTo(frame.width, frame.height / 2);
      ctx.stroke();

      ripples = ripples.filter((r) => r.life > 0);
      for (const ripple of ripples) {
        ripple.r += (18 + frame.level * 50) * frame.dt;
        ripple.life -= frame.dt / 1.6;
        const alpha = Math.max(0, ripple.life);
        // Ellipse = perspective pond.
        ctx.strokeStyle = frame.colors.primary;
        ctx.globalAlpha = alpha * 0.7;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = frame.colors.accent;
        ctx.globalAlpha = alpha * 0.35;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y, ripple.r * 0.6, ripple.r * 0.19, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
