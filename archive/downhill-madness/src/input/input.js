// Keyboard + touch, normalized to { steer: -1..1, jump, trick } (spec §3, §10).
export function createInput() {
  const keys = new Set();
  let jumpQueued = 0; // timestamp for the 100 ms jump buffer
  let trickQueued = false;
  let anyPressed = false;
  const listeners = { any: [], mute: [] };

  const isSteerLeft = () => keys.has('KeyA') || keys.has('ArrowLeft');
  const isSteerRight = () => keys.has('KeyD') || keys.has('ArrowRight');

  window.addEventListener('keydown', (e) => {
    if (e.repeat) { keys.add(e.code); return; }
    anyPressed = true;
    for (const fn of listeners.any) fn(e.code);
    if (e.code === 'KeyM') for (const fn of listeners.mute) fn();
    if (['Space', 'KeyW', 'ArrowUp'].includes(e.code)) { jumpQueued = performance.now(); e.preventDefault(); }
    if (['KeyS', 'ArrowDown', 'KeyT'].includes(e.code)) trickQueued = true;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // --- touch ---
  let touchSteer = 0;
  const touches = new Map(); // id -> {x0, y0, t0, steering}
  window.addEventListener('touchstart', (e) => {
    anyPressed = true;
    for (const fn of listeners.any) fn('touch');
    for (const t of e.changedTouches) {
      touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, t0: performance.now(), moved: false });
    }
    // a second finger while one is already steering = trick
    if (touches.size >= 2) trickQueued = true;
    recomputeTouchSteer(e);
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      const dy = t.clientY - rec.y0;
      const dx = t.clientX - rec.x0;
      if (dy < -46 && Math.abs(dy) > Math.abs(dx) * 1.2 && !rec.moved) {
        jumpQueued = performance.now();
        rec.moved = true;
      }
      if (dy > 46 && Math.abs(dy) > Math.abs(dx) * 1.2 && !rec.moved) {
        trickQueued = true;
        rec.moved = true;
      }
    }
    recomputeTouchSteer(e);
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) touches.delete(t.identifier);
    recomputeTouchSteer(e);
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  function recomputeTouchSteer(e) {
    touchSteer = 0;
    for (const t of e.touches) {
      touchSteer += t.clientX < window.innerWidth / 2 ? -1 : 1;
    }
    touchSteer = Math.max(-1, Math.min(1, touchSteer));
  }

  return {
    getSteer() {
      let s = 0;
      if (isSteerLeft()) s -= 1;
      if (isSteerRight()) s += 1;
      return s !== 0 ? s : touchSteer;
    },
    // jump input is buffered 100 ms (spec §4.3)
    consumeJump() {
      if (jumpQueued && performance.now() - jumpQueued < 100) { jumpQueued = 0; return true; }
      return false;
    },
    peekJumpBuffered() {
      return jumpQueued !== 0 && performance.now() - jumpQueued < 100;
    },
    consumeTrick() {
      const t = trickQueued; trickQueued = false; return t;
    },
    consumeAny() { const a = anyPressed; anyPressed = false; return a; },
    onAny(fn) { listeners.any.push(fn); },
    onMute(fn) { listeners.mute.push(fn); },
  };
}
