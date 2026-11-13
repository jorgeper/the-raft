// Score = floor(distance m) + style points (spec §4.5). Pure logic —
// storage is injected so tests can mock it.

export const POINTS = {
  nearMiss: 50,
  threading: 100,
  airPerSecond: 30,
  spinBase: 250, // 250, 500, 750... stacking per extra rotation in one jump
  scatter: 25,
};
export const COMBO_WINDOW = 3;
export const COMBO_MULT = 1.5;

export function spinPoints(rotations) {
  // 1 spin = 250, 2 spins = 250+500, 3 = 250+500+750...
  let total = 0;
  for (let i = 1; i <= rotations; i++) total += POINTS.spinBase * i;
  return total;
}

export function airPoints(seconds, rampLaunched) {
  return Math.floor(seconds * POINTS.airPerSecond) * (rampLaunched ? 2 : 1);
}

export function createScore() {
  const state = {
    distance: 0,
    style: 0,
    events: [], // { t, label, pts } for the end-screen breakdown
    recent: [], // combo window
    comboCount: 0,
  };

  function addStyle(t, label, pts) {
    state.recent = state.recent.filter((e) => t - e.t < COMBO_WINDOW);
    state.recent.push({ t, pts });
    let comboBonus = 0;
    // any 3 style events within 3 s multiplies that window (spec §4.5)
    if (state.recent.length >= 3) {
      const windowPts = state.recent.reduce((a, e) => a + e.pts, 0);
      comboBonus = Math.round(windowPts * (COMBO_MULT - 1));
      state.recent = [];
      state.comboCount++;
    }
    state.style += pts + comboBonus;
    state.events.push({ t, label, pts });
    if (comboBonus > 0) state.events.push({ t, label: 'COMBO x1.5', pts: comboBonus });
    return { pts, comboBonus };
  }

  return {
    state,
    addStyle,
    setDistance(s) { state.distance = Math.floor(s); },
    total() { return state.distance + state.style; },
    breakdown() {
      const grouped = new Map();
      for (const e of state.events) {
        const g = grouped.get(e.label) || { count: 0, pts: 0 };
        g.count++; g.pts += e.pts;
        grouped.set(e.label, g);
      }
      return [...grouped.entries()].map(([label, g]) => ({ label, ...g }));
    },
    reset() {
      state.distance = 0; state.style = 0;
      state.events = []; state.recent = []; state.comboCount = 0;
    },
  };
}

export function createBestStore(storage) {
  const KEY = 'downhill-madness-best';
  return {
    get() {
      try {
        const raw = storage.getItem(KEY);
        return raw ? JSON.parse(raw) : { score: 0, distance: 0 };
      } catch { return { score: 0, distance: 0 }; }
    },
    submit(score, distance) {
      const best = this.get();
      const isNew = score > best.score;
      if (isNew) {
        try { storage.setItem(KEY, JSON.stringify({ score, distance })); } catch { /* private mode */ }
      }
      return isNew;
    },
  };
}
