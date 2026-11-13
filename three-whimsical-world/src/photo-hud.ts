/**
 * The photo session's progress card, at the bottom of the view: how many of how many, a bar, what the current photo
 * is (place · time · season · weather · vibe · lens), the time left, and the last photo taken as a thumbnail, with a
 * soft shutter flash each time one is saved. At the end it says where the photos went, and stays a few seconds.
 * It is page overlay only: the photos are taken from the canvas, so none of it shows up in them.
 */
export class SessionHud {
  private readonly root: HTMLDivElement;
  private readonly count: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly what: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly thumb: HTMLImageElement;
  private readonly flash: HTMLDivElement;
  private started = 0;
  private hideTimer = 0;

  constructor(stage: HTMLElement) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.flash = el('div', 'session-flash', stage);
    this.root = el('div', 'session-hud', stage);
    this.thumb = el('img', 'session-thumb', this.root);
    const body = el('div', 'session-body', this.root);
    const head = el('div', 'session-head', body);
    el('div', 'session-title', head).textContent = '📸 Photo session';
    this.count = el('div', 'session-count', head);
    this.bar = el('div', 'session-fill', el('div', 'session-bar', body));
    this.what = el('div', 'session-what', body);
    this.hint = el('div', 'session-hint', body);
  }

  start(total: number) {
    clearTimeout(this.hideTimer);
    this.started = performance.now();
    this.thumb.removeAttribute('src');
    this.thumb.style.visibility = 'hidden';
    this.root.classList.add('on');
    this.progress(0, total, 'Planning the session…');
  }

  /** Framing photo `i` (0-based) of `total`. */
  progress(i: number, total: number, caption: string) {
    this.count.textContent = `${Math.min(i + 1, total)} / ${total}`;
    this.bar.style.width = `${(100 * i) / total}%`;
    this.what.textContent = caption;
    const per = i > 0 ? (performance.now() - this.started) / 1000 / i : 0;
    const left = per * (total - i);
    this.hint.textContent = `${i > 0 ? (left < 60 ? `about ${Math.max(5, Math.round(left / 5) * 5)} s left` : `about ${Math.round(left / 60)} min left`) + ' · ' : ''}Esc to stop`;
  }

  /** A photo was saved: show it, and the shutter. */
  shot(png: Blob) {
    if (this.thumb.src) URL.revokeObjectURL(this.thumb.src);
    this.thumb.src = URL.createObjectURL(png);
    this.thumb.style.visibility = 'visible';
    this.flash.classList.remove('go');
    void this.flash.offsetWidth; // restart the animation
    this.flash.classList.add('go');
  }

  finish(saved: number, total: number, where: string, stopped: boolean) {
    this.bar.style.width = `${(100 * saved) / total}%`;
    this.count.textContent = `${saved} / ${total}`;
    this.what.textContent = saved ? `${stopped ? 'Stopped: ' : '✅ '}${saved} photo${saved === 1 ? '' : 's'} saved` : 'Stopped: no photos taken';
    this.hint.textContent = saved ? where : '';
    this.hideTimer = window.setTimeout(() => this.root.classList.remove('on'), 9000);
  }
}
