// starfield: flying through stars — your voice is the throttle.

import type { EffectFrame, EffectRenderer } from "./types";
import { lerp, mulberry } from "./types";

interface Star {
  x: number;
  y: number;
  z: number;
}

const COUNT = 70;

export function createStarfield(): EffectRenderer {
  const rand = mulberry(1337);
  let stars: Star[] = [];
  let speed = 0;
  return {
    init() {
      stars = Array.from({ length: COUNT }, () => ({
        x: rand() * 2 - 1,
        y: rand() * 2 - 1,
        z: 0.1 + rand() * 0.9,
      }));
      speed = 0;
    },
    dispose() {
      stars = [];
    },
    render(ctx, frame: EffectFrame) {
      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const base = frame.reducedMotion ? 0.02 : 0.08;
      speed = lerp(speed, base + frame.level * (frame.reducedMotion ? 0.1 : 0.9), 0.1);
      for (const star of stars) {
        star.z -= speed * frame.dt;
        if (star.z <= 0.05) {
          star.x = rand() * 2 - 1;
          star.y = rand() * 2 - 1;
          star.z = 1;
        }
        const px = cx + (star.x / star.z) * cx * 0.9;
        const py = cy + (star.y / star.z) * cy * 0.9;
        if (px < 0 || px > frame.width || py < 0 || py > frame.height) continue;
        const size = (1 - star.z) * 2.6 + 0.4;
        ctx.fillStyle = star.z < 0.3 ? frame.colors.accent : frame.colors.primary;
        ctx.globalAlpha = (1 - star.z) * 0.9 + 0.1;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
