// particle-fountain: particles spray upward from the center as you speak.

import type { EffectFrame, EffectRenderer } from "./types";
import { mulberry } from "./types";

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  accent: boolean;
}

export function createParticleFountain(): EffectRenderer {
  const rand = mulberry(42);
  let particles: P[] = [];
  return {
    init() {
      particles = [];
    },
    dispose() {
      particles = [];
    },
    render(ctx, frame: EffectFrame) {
      const spawnBudget = frame.reducedMotion ? 1 : 6;
      const spawn = Math.round(frame.level * spawnBudget);
      for (let i = 0; i < spawn && particles.length < 160; i++) {
        particles.push({
          x: frame.width / 2 + (rand() - 0.5) * 24,
          y: frame.height,
          vx: (rand() - 0.5) * 60,
          vy: -(40 + rand() * 120 * frame.level),
          life: 1,
          accent: rand() > 0.7,
        });
      }
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx * frame.dt;
        p.y += p.vy * frame.dt;
        p.vy += 90 * frame.dt; // gravity
        p.life -= frame.dt * 0.9;
        ctx.fillStyle = p.accent ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = Math.max(0, p.life) * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 + p.life * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
