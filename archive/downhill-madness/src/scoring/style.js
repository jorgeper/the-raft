// Near-miss & threading detection (spec §4.5). Works on track-space boxes.
const PLAYER_HALF = 0.3;
const NEAR_MISS_MARGIN = 0.5;
const THREAD_GAP = 2.5;

export function createStyleDetector() {
  let lastRelative = new WeakMap(); // inst -> number[] (box.s - playerS last tick)

  function reset() {
    lastRelative = new WeakMap();
  }

  // returns events: [{ kind: 'nearMiss'|'thread', l }]
  function detectPasses(instances, player, collidedThisFrame) {
    const events = [];
    const passedNow = [];
    for (const inst of instances) {
      const prev = lastRelative.get(inst) || [];
      const cur = [];
      inst.boxes.forEach((box, i) => {
        const r = box.s - player.s;
        cur[i] = r;
        if (box.kind !== 'solid') return;
        const wasAhead = prev[i] === undefined ? r > 0 : prev[i] > 0;
        if (wasAhead && r <= 0) passedNow.push(box);
      });
      lastRelative.set(inst, cur);
    }

    if (!collidedThisFrame) {
      for (const box of passedNow) {
        const latGap = Math.abs(player.l - box.l) - (box.hl + PLAYER_HALF);
        const vertGap = player.footY - (box.y + box.hy);
        const laterallyClose = latGap >= 0 && latGap < NEAR_MISS_MARGIN;
        const clearedJustOver = vertGap >= 0 && vertGap < NEAR_MISS_MARGIN && Math.abs(player.l - box.l) < box.hl + PLAYER_HALF;
        if (laterallyClose || clearedJustOver) events.push({ kind: 'nearMiss' });
      }
      // threading: passed between two near-simultaneous solids with a tight gap
      for (let i = 0; i < passedNow.length; i++) {
        for (let j = i + 1; j < passedNow.length; j++) {
          const a = passedNow[i].l < passedNow[j].l ? passedNow[i] : passedNow[j];
          const b = passedNow[i].l < passedNow[j].l ? passedNow[j] : passedNow[i];
          if (Math.abs(a.s - b.s) > 1.5) continue;
          const gapLo = a.l + a.hl, gapHi = b.l - b.hl;
          const gap = gapHi - gapLo;
          if (gap > PLAYER_HALF * 2 && gap < THREAD_GAP && player.l > gapLo && player.l < gapHi) {
            events.push({ kind: 'thread' });
          }
        }
      }
    }
    return events;
  }

  return { detectPasses, reset };
}
