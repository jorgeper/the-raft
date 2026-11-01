import * as THREE from 'three';

/** Teardrop flame: bright at the base, fading to a soft point. */
function createFlameTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const v = 1 - y / 127; // 0 at the top, 1 at the bottom
      const halfWidth = 0.5 * Math.pow(Math.sin(Math.PI * Math.min(v * 1.15, 1)), 0.7) * (0.35 + 0.65 * v);
      const dx = Math.abs(x / 63 - 0.5) / Math.max(halfWidth, 1e-3);
      const a = Math.max(0, 1 - dx * dx) * Math.pow(v, 0.6);
      const i = (y * 64 + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A torch held in the right hand: a visible stick with a flickering flame, a shadow-casting spotlight aimed
 * where you look, and a soft omnidirectional glow around you. Attach `object` to the camera.
 */
export class Torch {
  readonly object = new THREE.Group();
  /** Shadow-casting light, aimed along the view. */
  readonly spot = new THREE.SpotLight('#ff9a4a', 0, 40, 1.15, 0.9, 2);
  /** Fill so the ground around you and behind you is lit too (no shadows; cheap). */
  readonly glow = new THREE.PointLight('#ff8a3a', 0, 22, 2);
  /** World-space flame position and color×intensity for the volumetric glow in the haze pass. */
  readonly flameWorld = new THREE.Vector3();
  readonly flameColor = new THREE.Color();
  on = false;

  private flame = new THREE.Group();
  private flameParts: THREE.Sprite[] = [];
  private level = 0;

  constructor() {
    // Stick and wrapped head, angled forward-left as if held in the right hand.
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.9 }),
    );
    const wrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.028, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: '#2a1c12', roughness: 1, emissive: '#ff5a10', emissiveIntensity: 0.15 }),
    );
    wrap.position.y = 0.3;
    const stick = new THREE.Group();
    stick.add(handle, wrap);

    // Flame: soft additive sprites (outer orange, inner yellow, white-hot core), each flickering on its own.
    const flameTexture = createFlameTexture();
    for (const [color, w, h, intensity] of [
      ['#ff4a10', 0.16, 0.3, 1.6],
      ['#ff9a30', 0.11, 0.21, 2.2],
      ['#fff0c0', 0.05, 0.09, 3],
    ] as const) {
      const part = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flameTexture,
          color: new THREE.Color(color).multiplyScalar(intensity),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      part.scale.set(w, h, 1);
      part.center.set(0.5, 0.15);
      part.userData.size = [w, h];
      this.flameParts.push(part);
      this.flame.add(part);
    }
    this.flame.position.y = 0.36;
    stick.add(this.flame);
    stick.rotation.set(-0.35, 0, -0.25);
    stick.position.set(0.42, -0.55, -0.85);
    this.object.add(stick);
    this.object.visible = false;

    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0008;
    this.spot.shadow.normalBias = 0.05;
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.camera.far = 40;
    this.spot.visible = false;
    this.glow.visible = false;
  }

  toggle() {
    this.on = !this.on;
  }

  /** Call each frame after the camera moves. */
  update(camera: THREE.Camera, time: number, dt: number) {
    // Ease in/out so lighting it feels like it catches.
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(dt * 6, 1);
    const visible = this.level > 0.01;
    this.object.visible = this.spot.visible = this.glow.visible = visible;
    if (!visible) {
      this.flameColor.setRGB(0, 0, 0);
      return;
    }

    // Layered sines make an irregular flicker without a noise texture.
    const flicker =
      0.82 + 0.1 * Math.sin(time * 13.1) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.05 * Math.sin(time * 41.3 + 0.7);
    this.flameParts.forEach((part, i) => {
      const [w, h] = part.userData.size as [number, number];
      part.scale.set(w * (1 + 0.08 * Math.sin(time * (11 + i * 5))), h * (1 + 0.2 * Math.sin(time * (17 + i * 6) + i)), 1);
      part.material.rotation = 0.12 * Math.sin(time * (9 + i * 4));
    });

    this.flame.getWorldPosition(this.flameWorld);
    this.spot.position.copy(this.flameWorld);
    this.glow.position.copy(this.flameWorld);
    // Aim where the camera looks, slightly down so the path ahead is lit.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y -= 0.25;
    this.spot.target.position.copy(this.flameWorld).addScaledVector(forward.normalize(), 10);
    this.spot.target.updateMatrixWorld();

    this.spot.intensity = 32 * flicker * this.level;
    this.glow.intensity = 7 * flicker * this.level;
    this.flameColor.set('#ff8a3a').multiplyScalar(flicker * this.level);
  }
}
