// fireflies: drifting glow-bugs that brighten and quicken as you talk.

import type { EffectFrame, EffectRenderer } from "./types";
import { mulberry } from "./types";

interface Fly {
  x: number;
  y: number;
  phase: number;
  drift: number;
  accent: boolean;
}

const COUNT = 16;

export function createFireflies(): EffectRenderer {
  const rand = mulberry(99);
  let flies: Fly[] = [];
  return {
    init(_, width, height) {
      flies = Array.from({ length: COUNT }, () => ({
        x: rand() * width,
        y: rand() * height,
        phase: rand() * Math.PI * 2,
        drift: 0.5 + rand(),
        accent: rand() > 0.65,
      }));
    },
    dispose() {
      flies = [];
    },
    render(ctx, frame: EffectFrame) {
      const speed = frame.reducedMotion ? 3 : 9 + frame.level * 30;
      for (const fly of flies) {
        fly.phase += frame.dt * fly.drift * (frame.reducedMotion ? 0.4 : 1.2);
        fly.x += Math.cos(fly.phase) * speed * frame.dt * fly.drift;
        fly.y += Math.sin(fly.phase * 1.3) * speed * frame.dt * 0.6;
        if (fly.x < -6) fly.x = frame.width + 6;
        if (fly.x > frame.width + 6) fly.x = -6;
        if (fly.y < -6) fly.y = frame.height + 6;
        if (fly.y > frame.height + 6) fly.y = -6;

        const blink = 0.5 + Math.sin(fly.phase * 2.2) * 0.5;
        const bright = blink * (0.3 + frame.level * 0.7);
        ctx.fillStyle = fly.accent ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = 0.15 + bright * 0.85;
        ctx.shadowColor = frame.colors.glow;
        ctx.shadowBlur = 4 + bright * 10;
        ctx.beginPath();
        ctx.arc(fly.x, fly.y, 1.4 + bright * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
  };
}
