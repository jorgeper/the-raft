import * as THREE from 'three';

/**
 * Photo mode (O): a free camera with a real lens. The field of view is a focal length on a full-frame sensor
 * (wheel zooms from 14 to 200 mm), the f-stop sets how shallow the depth of field is, and focus either follows
 * the middle of the frame (eased, like a camera's autofocus) or locks onto whatever you right-click. Time can be
 * frozen, Enter saves the frame as a PNG, and the HUD gives way to a viewfinder overlay.
 */

export const photoSettings = {
  fStop: 2.8,
  /** Extra blur on top of the real lens: landscapes look flat at true depth of field. */
  dreamy: 3,
  freeze: false,
};

/**
 * The lens while you play (outside photo mode): a real focal length and f-stop, focus following your character in
 * third person or the middle of the frame in first. `setsFov` lets the focal length set the field of view (a 48 mm
 * lens sees what a 48 mm lens sees); off, the view keeps the panel's field of view and the blur is scaled to it.
 */
export const lensSettings = {
  on: false,
  /** Focal length (mm). */
  focal: 48,
  fStop: 1.2,
  dreamy: 1,
  setsFov: true,
};

/** Full-frame sensor height (m): sets the focal length for a field of view. */
const SENSOR = 0.024;
export const fovFor = (focal: number) => THREE.MathUtils.radToDeg(2 * Math.atan(SENSOR / 2 / focal));

type LensUniforms = { uFocus: { value: number }; uFocal: { value: number }; uAperture: { value: number }; uPxPerM: { value: number }; uMaxBlur: { value: number }; uRadScale: { value: number }; uFar: { value: number } };

/**
 * Fills the depth-of-field uniforms for a lens (focal in m). The image on the sensor fills the frame's height
 * whatever the field of view: at the lens's own field of view that's the 24 mm sensor, at another it's a sensor
 * cropped (or enlarged) to match, so the blur keeps its size relative to the frame.
 */
function fillLens(uniforms: LensUniforms, focal: number, fStop: number, dreamy: number, focus: number, fovDeg: number, heightPx: number, far: number) {
  const sensor = 2 * focal * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const scale = heightPx / 720;
  uniforms.uFocus.value = focus;
  uniforms.uFocal.value = focal;
  uniforms.uAperture.value = (focal / fStop) * dreamy;
  uniforms.uPxPerM.value = heightPx / sensor;
  uniforms.uMaxBlur.value = 22 * scale;
  uniforms.uRadScale.value = 0.9 * scale;
  uniforms.uFar.value = far;
}

/** Eases a focus distance toward a target in log distance, like a focus ring pulled by a motor. */
const easeFocus = (focus: number, target: number, dt: number) => Math.exp(Math.log(focus) + (Math.log(target) - Math.log(focus)) * Math.min(dt * 5, 1));

/** The lens while playing: autofocus on the character (a distance given each frame) or on the middle of the frame. */
export class PlayLens {
  focus = 5;
  private target = 5;
  private frame = 0;

  /** `subject`: the character's distance along the view, or null to focus on whatever is in the middle. */
  update(dt: number, subject: number | null, distanceAt: (u: number, v: number) => number, far: number, fovDeg: number, heightPx: number, uniforms: LensUniforms) {
    if (subject !== null) this.target = Math.max(subject, 0.3);
    else if (this.frame++ % 6 === 0) {
      const d = distanceAt(0.5, 0.5);
      if (Number.isFinite(d) && d > 0) this.target = Math.min(d, far);
    }
    this.focus = easeFocus(this.focus, this.target, dt);
    fillLens(uniforms, lensSettings.focal / 1000, lensSettings.fStop, lensSettings.dreamy, this.focus, fovDeg, heightPx, far);
  }
}

export class PhotoMode {
  active = false;
  /** Focal length (m). */
  focal = 0.035;
  /** Current focus distance (m), easing toward `target`. */
  focus = 10;
  private target = 10;
  /** Where focus is held (uv), or null to follow the middle of the frame. */
  private lockAt: { u: number; v: number } | null = null;
  private frame = 0;
  readonly overlay: HTMLDivElement;
  private reticle: HTMLDivElement;
  private info: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'photo';
    this.overlay.innerHTML = `
      <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
      <div class="reticle"></div>
      <div class="info"></div>`;
    parent.appendChild(this.overlay);
    this.reticle = this.overlay.querySelector('.reticle')!;
    this.info = this.overlay.querySelector('.info')!;
  }

  /** Starts at a 50 mm "normal" lens: the walking view's wide angle keeps nearly everything sharp. */
  enter() {
    this.active = true;
    this.focal = 0.05;
    this.lockAt = null;
    this.frame = 0;
  }

  exit() {
    this.active = false;
  }

  get fov() {
    return fovFor(this.focal);
  }

  /** Mouse wheel: zoom, as a focal length between 14 and 200 mm. */
  zoom(deltaY: number) {
    this.focal = THREE.MathUtils.clamp(this.focal * Math.exp(-deltaY * 0.0012), 0.014, 0.2);
  }

  /** Right-click: hold focus on this screen point; on the sky, back to autofocus. */
  focusOn(u: number, v: number, distance: number, far: number) {
    if (!Number.isFinite(distance) || distance > far * 0.9) {
      this.lockAt = null;
      return;
    }
    this.lockAt = { u, v };
    this.target = distance;
  }

  /**
   * Eases the focus and fills the lens uniforms. `distanceAt` reads the scene's distance at a screen point (from
   * the last frame); it's read a few times a second, not every frame (each read waits on the GPU).
   */
  update(
    dt: number,
    distanceAt: (u: number, v: number) => number,
    far: number,
    heightPx: number,
    uniforms: LensUniforms,
  ) {
    const at = this.lockAt ?? { u: 0.5, v: 0.5 };
    if (this.frame++ % 4 === 0) {
      const d = distanceAt(at.u, at.v);
      if (Number.isFinite(d) && d > 0) this.target = Math.min(d, far);
    }
    this.focus = easeFocus(this.focus, this.target, dt);
    fillLens(uniforms, this.focal, photoSettings.fStop, photoSettings.dreamy, this.focus, this.fov, heightPx, far);

    this.reticle.style.left = `${at.u * 100}%`;
    this.reticle.style.top = `${(1 - at.v) * 100}%`;
    this.reticle.classList.toggle('locked', this.lockAt !== null);
    const focusText = this.focus >= far * 0.85 ? '∞' : this.focus < 10 ? `${this.focus.toFixed(1)} m` : `${Math.round(this.focus)} m`;
    this.info.textContent = `${Math.round(this.focal * 1000)} mm · f/${photoSettings.fStop.toFixed(1)} · focus ${focusText}${this.lockAt ? ' (held)' : ''}`
      + `${photoSettings.freeze ? ' · time frozen' : ''}   —   wheel zoom · right-click focus · Enter save · O exit`;
  }
}

/** Saves the canvas as a PNG download. Call right after rendering, in the same frame. */
export function savePhoto(canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    a.download = `meadows-${stamp}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
