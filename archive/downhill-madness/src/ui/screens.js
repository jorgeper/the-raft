// Start / end screens (spec §9).
export function createScreens() {
  const el = {
    start: document.getElementById('startScreen'),
    end: document.getElementById('endScreen'),
    startBest: document.getElementById('startBest'),
    scoreLines: document.getElementById('scoreLines'),
    newBest: document.getElementById('newBest'),
    fader: document.getElementById('fader'),
  };

  return {
    showStart(best) {
      el.start.classList.remove('hidden');
      el.end.classList.add('hidden');
      if (best && best.score > 0) {
        el.startBest.classList.remove('hidden');
        el.startBest.textContent = `BEST ${best.score} · ${best.distance} m`;
      } else {
        el.startBest.classList.add('hidden');
      }
    },
    hideAll() {
      el.start.classList.add('hidden');
      el.end.classList.add('hidden');
    },
    showEnd({ distance, breakdown, style, total, isNewBest, best }) {
      const lines = [
        `<div class="scoreline"><span>Distance</span><span>${distance} m</span></div>`,
        ...breakdown.map(
          (b) => `<div class="scoreline"><span>${b.label} ×${b.count}</span><span>${b.pts}</span></div>`
        ),
        `<div class="scoreline"><span>Style total</span><span>${style}</span></div>`,
        `<div class="scoreline total"><span>SCORE</span><span>${total}</span></div>`,
        isNewBest ? '' : `<div class="scoreline"><span>Best</span><span>${best.score}</span></div>`,
      ];
      el.scoreLines.innerHTML = lines.join('');
      el.newBest.classList.toggle('hidden', !isNewBest);
      el.end.classList.remove('hidden');
    },
    flash() {
      el.fader.style.opacity = '0.85';
      setTimeout(() => { el.fader.style.opacity = '0'; }, 60);
    },
  };
}
