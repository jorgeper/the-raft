// Fixed-timestep simulation (60 Hz) decoupled from render (spec §10),
// with a global timeScale for crash slow-mo.
export const STEP = 1 / 60;

export function createLoop({ update, render }) {
  let accumulator = 0;
  let last = null;
  let running = false;
  let timeScale = 1;

  function frame(now) {
    if (!running) return;
    if (last === null) last = now;
    let frameDt = Math.min((now - last) / 1000, 0.25);
    last = now;
    accumulator += frameDt * timeScale;
    let steps = 0;
    while (accumulator >= STEP && steps < 8) {
      update(STEP);
      accumulator -= STEP;
      steps++;
    }
    render(accumulator / STEP, frameDt);
    requestAnimationFrame(frame);
  }

  return {
    start() { if (!running) { running = true; last = null; requestAnimationFrame(frame); } },
    stop() { running = false; },
    setTimeScale(s) { timeScale = s; },
    getTimeScale: () => timeScale,
  };
}
