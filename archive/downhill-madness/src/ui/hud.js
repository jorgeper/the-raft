// DOM HUD: distance, speed, style popups near the character (spec §9).
export function createHud() {
  const el = {
    hud: document.getElementById('hud'),
    distance: document.getElementById('distance'),
    speedo: document.getElementById('speedo'),
    style: document.getElementById('styleScore'),
    combo: document.getElementById('combo'),
    vignette: document.getElementById('vignetteFx'),
  };
  let comboFlash = 0;

  return {
    show() { el.hud.classList.remove('hidden'); },
    hide() { el.hud.classList.add('hidden'); },
    update(distance, speed, style, dt) {
      el.distance.textContent = `${Math.floor(distance)} m`;
      el.speedo.textContent = `${speed.toFixed(1)} m/s`;
      el.style.textContent = `STYLE ${style}`;
      if (comboFlash > 0) {
        comboFlash -= dt;
        if (comboFlash <= 0) el.combo.textContent = '';
      }
    },
    popup(text, screenX, screenY, big = false) {
      const d = document.createElement('div');
      d.className = big ? 'popup big' : 'popup';
      d.textContent = text;
      d.style.left = `${screenX}px`;
      d.style.top = `${screenY}px`;
      el.hud.appendChild(d);
      setTimeout(() => d.remove(), 1150);
    },
    combo() {
      el.combo.textContent = '★ COMBO x1.5 ★';
      comboFlash = 2;
    },
    // bee swarm smear (spec §6.1 #20)
    stingVision(seconds) {
      el.vignette.style.opacity = '1';
      setTimeout(() => { el.vignette.style.opacity = '0'; }, seconds * 1000);
    },
    // waterfall spray whiteout (spec §6.1 #24)
    whiteout(seconds) {
      const fader = document.getElementById('fader');
      fader.style.transition = 'opacity 0.25s';
      fader.style.opacity = '0.92';
      setTimeout(() => { fader.style.opacity = '0'; }, seconds * 1000);
    },
  };
}

// project a scene position to screen pixels
import * as THREE from 'three';
const _v = new THREE.Vector3();
export function toScreen(pos, camera) {
  _v.copy(pos).project(camera);
  return {
    x: (_v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_v.y * 0.5 + 0.5) * window.innerHeight,
    behind: _v.z > 1,
  };
}
