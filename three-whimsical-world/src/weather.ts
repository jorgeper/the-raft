import * as THREE from 'three';

/**
 * Weather: a small state machine that drifts between clear skies, fair-weather cumulus, building cloud, overcast and
 * showers, and the slow quantities that follow it (wet ground drying in the sun, a rainbow when a shower passes with
 * the sun out, morning mist that burns off, dew on the grass at dawn).
 *
 * Main reads the smoothed state every frame and drives the sky, sun, haze and materials from it; the materials read
 * `weatherUniforms` directly.
 */

export type WeatherKind = 'clear' | 'fair' | 'cloudy' | 'overcast' | 'rain';
/** 'auto' changes by itself; 'manual' leaves the cloud slider alone and never rains. */
export type WeatherMode = 'auto' | WeatherKind | 'manual';

interface Target {
  clouds: number;
  /** 0..1 how grey the whole sky is (the sun hidden, the light flat). */
  overcast: number;
  rain: number;
}
const TARGETS: Record<WeatherKind, Target> = {
  clear: { clouds: 0.12, overcast: 0, rain: 0 },
  fair: { clouds: 0.38, overcast: 0, rain: 0 },
  cloudy: { clouds: 0.62, overcast: 0.25, rain: 0 },
  overcast: { clouds: 0.85, overcast: 0.7, rain: 0 },
  rain: { clouds: 0.95, overcast: 1, rain: 1 },
};
/** Auto weather: what can follow each state, and how long (real seconds) a state lasts. */
const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['fair', 1]],
  fair: [['clear', 0.35], ['cloudy', 0.65]],
  cloudy: [['fair', 0.45], ['overcast', 0.55]],
  overcast: [['rain', 0.7], ['cloudy', 0.3]],
  rain: [['cloudy', 0.75], ['overcast', 0.25]],
};
const DURATION: Record<WeatherKind, [number, number]> = {
  clear: [150, 300],
  fair: [180, 420],
  cloudy: [90, 200],
  overcast: [60, 140],
  rain: [70, 160],
};

/** Uniforms shared by every material that reacts to the weather (terrain, water, rocks, grass). */
export const weatherUniforms = {
  /** 0 dry .. 1 soaked: darker, glossier ground, puddles in hollows. */
  uWet: { value: 0 },
  /** Rain falling now (ripple rings on water and puddles). */
  uRain: { value: 0 },
  /** Dew on the grass: sparkles toward the sun in the early morning. */
  uDew: { value: 0 },
  uWeatherTime: { value: 0 },
};

/**
 * GLSL: expanding rings where raindrops land, as a 2D slope to add to a surface's gradient. Two jittered grids of
 * drops at different rates; `p` in meters.
 */
export const RAIN_RIPPLES = /* glsl */ `
  vec2 rainRipples(vec2 p, float t) {
    vec2 g = vec2(0.0);
    for (int k = 0; k < 2; k++) {
      vec2 q = p * (k == 0 ? 2.3 : 3.4) + float(k) * 17.3;
      vec2 cell = floor(q);
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      vec2 d = fract(q) - 0.5 - (vec2(fract(h * 17.0), fract(h * 31.0)) - 0.5) * 0.5;
      float phase = fract(t * (0.9 + 0.5 * h) + h * 7.0);
      float r = phase * 0.42;
      float dist = length(d);
      float ring = sin((dist - r) * 45.0) * (1.0 - smoothstep(0.0, 0.07, abs(dist - r))) * (1.0 - phase) * (1.0 - phase);
      g += d / max(dist, 1e-3) * ring;
    }
    return g;
  }
`;

/**
 * GLSL: the rainbow seen along view direction `d` (world, normalized), opposite the sun: violet inside at 40°, red
 * outside at 42°, a fainter reversed secondary bow at 51-54°, the sky a touch brighter inside the primary and
 * darker between the bows (Alexander's band). Returns light to add, for a sun of unit brightness.
 */
export const RAINBOW = /* glsl */ `
  vec3 bowColor(float t) {
    return clamp(vec3(smoothstep(0.45, 0.8, t), 1.0 - abs(t - 0.55) * 3.2, 1.0 - abs(t - 0.18) * 3.6), 0.0, 1.0)
      * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.9, 1.0, t));
  }
  vec3 rainbow(vec3 d, vec3 sunDir) {
    float ang = degrees(acos(clamp(dot(d, -sunDir), -1.0, 1.0)));
    vec3 bow1 = bowColor((ang - 39.8) / 2.6);
    vec3 bow2 = bowColor(1.0 - (ang - 50.5) / 3.4);
    float inside = 1.0 - smoothstep(38.0, 40.5, ang);
    return bow1 * 0.5 + bow2 * 0.16 + vec3(inside * 0.06);
  }
`;

export class Weather {
  mode: WeatherMode = 'auto';
  /** Smoothed state, what the world shows now. */
  clouds = 0.38;
  overcast = 0;
  rain = 0;
  wetness = 0;
  rainbow = 0;
  mist = 0;
  dew = 0;
  /** The auto weather's current state and how long it has left. */
  kind: WeatherKind = 'fair';
  private left = 240;
  private sinceRain = 1e9;
  private rand = Math.random;

  /** Starts the auto weather in a given state (the opening scene is fair). */
  set(kind: WeatherKind, seconds = 240) {
    this.kind = kind;
    this.left = seconds;
  }

  /**
   * Advances the weather by `dt` real seconds. `manualClouds` is the cloud slider (used in manual mode);
   * `hours` and `sunElevation` (degrees) time the mist, dew and rainbow.
   */
  update(dt: number, manualClouds: number, hours: number, sunElevation: number) {
    if (this.mode === 'auto') {
      this.left -= dt;
      if (this.left <= 0) {
        const options = NEXT[this.kind];
        let r = this.rand();
        let next = options[options.length - 1][0];
        for (const [k, p] of options) if ((r -= p) <= 0) {
          next = k;
          break;
        }
        const [lo, hi] = DURATION[next];
        this.set(next, lo + this.rand() * (hi - lo));
      }
    }
    const target: Target =
      this.mode === 'manual' ? { clouds: manualClouds, overcast: 0, rain: 0 } : TARGETS[this.mode === 'auto' ? this.kind : this.mode];
    // Cloud builds over a minute or so; rain starts and stops over ~15 s, after the sky has greyed.
    const k = Math.min(dt / 40, 1);
    this.clouds += (target.clouds - this.clouds) * k;
    this.overcast += (target.overcast - this.overcast) * k;
    const rainGoal = target.rain * THREE.MathUtils.smoothstep(this.overcast, 0.6, 0.9);
    this.rain += (rainGoal - this.rain) * Math.min(dt / 12, 1);

    // The ground soaks up quickly in rain and dries over a few minutes (faster in sun).
    const sun = THREE.MathUtils.smoothstep(sunElevation, 0, 25) * (1 - this.overcast);
    if (this.rain > 0.05) this.wetness = Math.min(1, this.wetness + this.rain * dt / 25);
    else this.wetness = Math.max(0, this.wetness - dt / (240 - 150 * sun));

    // A rainbow when a shower passes and the sun breaks through low enough behind you (below 42°).
    this.sinceRain = this.rain > 0.3 ? 0 : this.sinceRain + dt;
    const bowSky = THREE.MathUtils.smoothstep(sunElevation, 0, 4) * (1 - THREE.MathUtils.smoothstep(sunElevation, 30, 40));
    const bowGoal = this.sinceRain < 90 && this.wetness > 0.2 ? bowSky * (1 - THREE.MathUtils.smoothstep(this.overcast, 0.4, 0.75)) : 0;
    this.rainbow += (bowGoal - this.rainbow) * Math.min(dt / 6, 1);

    // Morning mist: rises before dawn, lies thick through the first hours and burns off by mid-morning; heavier
    // after rain, and some mist hangs in the air while it rains.
    const morning = THREE.MathUtils.smoothstep(hours, 3.5, 5.5) * (1 - THREE.MathUtils.smoothstep(hours, 8.5, 10.5));
    const mistGoal = morning * (0.7 + 0.5 * this.wetness) + this.rain * 0.35;
    this.mist += (mistGoal - this.mist) * Math.min(dt / 8, 1);
    // Dew: dawn into early morning, gone by mid-morning (and while it rains, the drops don't sparkle).
    const dewGoal = THREE.MathUtils.smoothstep(hours, 4.5, 6) * (1 - THREE.MathUtils.smoothstep(hours, 8, 10)) * (1 - this.overcast);
    this.dew += (dewGoal - this.dew) * Math.min(dt / 8, 1);

    weatherUniforms.uWet.value = this.wetness;
    weatherUniforms.uRain.value = this.rain;
    weatherUniforms.uDew.value = this.dew;
  }
}
