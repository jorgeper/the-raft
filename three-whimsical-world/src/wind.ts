import * as THREE from 'three';

/** Shared by every swaying material so grass and trees move with the same gusts. */
export const wind = {
  uTime: { value: 0 },
  /** Last frame's time: the wind is evaluated at both, and the difference is the motion TAA reprojects with. */
  uPrevTime: { value: 0 },
  uWindStrength: { value: 1 },
};

/**
 * The panel's wind: `value` is the base strength (the slider), and with `changing` on the weather of the wind drifts
 * by itself around it: still spells, steady breezes, blustery hours and now and then a gale, each easing into the
 * next over half a minute or so. `now` is what's blowing (base × the drift), shown read-only in the panel.
 */
export const windControl = { value: 1, changing: true, now: 1 };

/** Spells of wind as (chance, low, high) multipliers of the base strength. */
const SPELLS: [number, number, number][] = [
  [0.18, 0.1, 0.35], // still: the grass barely stirs
  [0.4, 0.7, 1.2], // a breeze
  [0.3, 1.5, 2.1], // blustery
  [0.12, 2.5, 3.0], // a gale
];

export class WindDrift {
  level = 1;
  private target = 1;
  private next = 20;
  private time = 0;

  /** Advances the drift and sets `wind.uWindStrength`. `storm` (0..1, the rain) pushes it toward the windy end. */
  update(dt: number, storm: number) {
    this.time += dt;
    if (!windControl.changing) {
      this.level = this.target = 1;
      this.next = this.time + 20;
    } else {
      if (this.time > this.next) {
        let r = Math.random();
        const spell = SPELLS.find(([p]) => (r -= p) < 0) ?? SPELLS[1];
        this.target = spell[1] + Math.random() * (spell[2] - spell[1]);
        // Gales blow themselves out sooner than calms and breezes last.
        this.next = this.time + (this.target > 2.4 ? 25 + Math.random() * 35 : 45 + Math.random() * 90);
      }
      // Rising to a gale is quicker than dying down; a slow swell on top keeps even a steady spell alive.
      const rate = this.target > this.level ? 1 / 12 : 1 / 25;
      this.level += (this.target - this.level) * Math.min(dt * rate, 1);
    }
    const swell = windControl.changing ? 1 + 0.12 * Math.sin(this.time * 0.11) * Math.sin(this.time * 0.037 + 1.3) : 1;
    // Rain brings at least a fresh blow with it.
    const stormy = windControl.changing ? Math.max(this.level, 1.8 * storm) : this.level;
    windControl.now = Math.min(windControl.value * stormy * swell, 3.2);
    wind.uWindStrength.value = windControl.now;
  }
}

/** The wind blows along this world direction (x, z); `windOffset` displaces along it. */
export const WIND_DIR = new THREE.Vector2(1, 0.35).normalize();

/**
 * Wind motion travels to the TAA in the scene target's alpha: 1 + this × (meters moved along `WIND_DIR` since last
 * frame). Opaque materials write 1 (no motion), and MSAA edges average toward it, so a half-covered pixel gets half
 * the motion. The scale spreads the motion over more of half-float's precision near 1.
 */
export const MOTION_SCALE = 8;

/** Sun direction in view space and color, updated per frame, for effects that patch lighting (grass translucency). */
export const sunLight = {
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

/** GLSL: world-space displacement for a point rooted at `root`; `flex` is 0 at the base and 1 at the tip. */
export const windGLSL = /* glsl */ `
  uniform float uTime;
  uniform float uPrevTime;
  uniform float uWindStrength;
  // The time the wind is evaluated at (this frame's, or last frame's for the motion).
  float windT;
  vec3 windOffset(vec3 root, float flex) {
    vec2 dir = vec2(${WIND_DIR.x.toFixed(6)}, ${WIND_DIR.y.toFixed(6)});
    // Broad gusts rolling across the landscape in the wind direction.
    float along = dot(root.xz, dir);
    float gust = 0.5 + 0.5 * sin(along * 0.045 - windT * 1.3) * sin(root.x * 0.013 + root.z * 0.021 + windT * 0.4);
    // Local, faster flutter so neighbors don't move in lockstep.
    float flutter = sin(windT * 2.3 + root.x * 0.7 + root.z * 0.43) * 0.3 + sin(windT * 4.1 + root.z * 1.3) * 0.12;
    float amount = uWindStrength * flex * (0.15 + 0.85 * gust) * (0.75 + flutter);
    // Bent blades also dip slightly, so the tip follows an arc instead of stretching.
    return vec3(dir.x * amount, -0.35 * amount * amount, dir.y * amount);
  }
`;

/**
 * Patches a standard material so instanced vertices sway in the wind.
 * `body` is GLSL run after instancing; it gets `root` (instance origin) and `p` (world position, editable). Time in
 * the body is `windT` (`uTime` is rewritten to it): the body runs once at last frame's time and once at this frame's,
 * and the fragment shader writes how far the surface moved along the wind into alpha for the TAA (`MOTION_SCALE`).
 */
export function addWind(material: THREE.Material, body: string, extraUniforms: Record<string, THREE.IUniform> = {}) {
  const timed = body.replace(/\buTime\b/g, 'windT');
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind, extraUniforms);
    const decls = Object.keys(extraUniforms)
      .map((name) => `uniform ${glslType(extraUniforms[name].value)} ${name};`)
      .join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${windGLSL}\n${decls}\nvarying float vWindMotion;`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 root = instanceMatrix[3].xyz;
        #else
          vec3 root = vec3(0.0);
        #endif
        vec3 p = mvPosition.xyz;
        windT = uPrevTime;
        { ${timed} }
        vec3 pPrev = p;
        p = mvPosition.xyz;
        windT = uTime;
        { ${timed} }
        vWindMotion = dot((p - pPrev).xz, vec2(${WIND_DIR.x.toFixed(6)}, ${WIND_DIR.y.toFixed(6)}));
        mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
    // (Alpha-to-coverage needs alpha for its coverage mask; those materials carry no motion. Main switches them to a
    // plain alpha test while TAA is on.)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWindMotion;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        #ifndef ALPHA_TO_COVERAGE
          gl_FragColor.a = 1.0 + clamp(vWindMotion * ${MOTION_SCALE.toFixed(1)}, -0.9, 0.9);
        #endif`,
      );
  };
}

function glslType(value: unknown): string {
  if (typeof value === 'number') return 'float';
  if (value instanceof THREE.Vector2) return 'vec2';
  if (value instanceof THREE.Vector3) return 'vec3';
  if (value instanceof THREE.Color) return 'vec3';
  throw new Error('Unsupported uniform type');
}
