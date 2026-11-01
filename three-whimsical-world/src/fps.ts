/**
 * Corner frame-rate readout: frames per second and frame time, averaged over the last second and refreshed
 * twice a second so it is readable rather than flickering. Turns amber below 50 fps and red below 30.
 */
export class FpsMeter {
  readonly element = document.createElement('div');
  private stamps: number[] = [];
  private lastText = 0;
  private visible = true;
  /** The latest smoothed values, for scripts that measure presets. */
  fps = 0;
  ms = 0;

  constructor() {
    this.element.className = 'fps';
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.element.style.display = on ? '' : 'none';
  }

  /** Call once per frame with the rAF timestamp (ms). */
  frame(now: number) {
    const s = this.stamps;
    s.push(now);
    while (s.length > 2 && now - s[0] > 1000) s.shift();
    if (now - this.lastText < 500 || s.length < 2) return;
    this.lastText = now;
    const span = now - s[0];
    this.ms = span / (s.length - 1);
    this.fps = 1000 / this.ms;
    if (!this.visible) return;
    this.element.textContent = `${Math.round(this.fps)} fps · ${this.ms.toFixed(1)} ms`;
    this.element.style.color = this.fps >= 50 ? '#c8f7c0' : this.fps >= 30 ? '#ffd27a' : '#ff8a7a';
  }
}
