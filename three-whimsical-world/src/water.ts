import * as THREE from 'three';
import { TERRAIN_SIZE } from './terrain';

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform samplerCube uEnv;
  uniform sampler2D uDepth;
  uniform float uTerrainSize;
  uniform float uMaxDepth;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  // Sum of directional waves travelling mostly toward the shore (-x). Returns the height gradient.
  vec2 waveGradient(vec2 p, float t, float fade) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      vec2 dir = normalize(vec2(-1.0, 1.1 * sin(fi * 2.37 + 0.5)));
      float wavelength = 22.0 * pow(0.78, fi);
      float k = 6.2831853 / wavelength;
      // Steepness-based amplitude keeps slopes realistic at every scale.
      float amp = (0.09 * pow(0.9, fi) / k) * mix(1.0, fade, step(4.0, fi));
      float speed = sqrt(9.81 / k);
      float phase = k * (dot(dir, p) - speed * t) + fi * 1.3;
      g += amp * k * cos(phase) * dir;
    }
    return g;
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // Fade small waves with distance to avoid aliasing shimmer.
    // Keep some small-wave roughness far out, or the distant sea becomes a mirror of the white horizon.
    float fade = mix(0.35, 1.0, 1.0 - smoothstep(40.0, 600.0, dist));
    vec2 g = waveGradient(vWorld.xz, uTime, fade);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    vec2 uv = vWorld.xz / uTerrainSize + 0.5;
    bool inside = all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
    float depth = inside ? texture2D(uDepth, uv).r * uMaxDepth : uMaxDepth;

    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = textureCube(uEnv, R).rgb * 0.6;
    // Capped: real sea surfaces rarely reflect the full sky even at grazing angles because of microfacets.
    float fresnel = min(0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0), 0.75);

    vec3 deepColor = vec3(0.012, 0.075, 0.14);
    vec3 shallowColor = vec3(0.04, 0.24, 0.24);
    vec3 body = mix(shallowColor, deepColor, 1.0 - exp(-depth * 0.3));
    body *= 0.35 + 0.65 * max(uSunDir.y, 0.0);

    vec3 col = mix(body, refl, fresnel);
    float spec = pow(max(dot(R, uSunDir), 0.0), 900.0);
    col += uSunColor * spec * 12.0;

    // Shoreline foam: bands that wash in and out with noise breakup.
    float n = vnoise(vWorld.xz * 0.6 + uTime * 0.2) * 0.6 + vnoise(vWorld.xz * 2.3 - uTime * 0.3) * 0.4;
    float bands = 0.5 + 0.5 * sin(depth * 9.0 - uTime * 1.4 + n * 4.0);
    float foam = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.35, 0.75, bands * n + 0.3);
    foam = max(foam, 1.0 - smoothstep(0.0, 0.06, depth));
    col = mix(col, vec3(0.85, 0.88, 0.88) * (0.5 + 0.5 * max(uSunDir.y, 0.2)), foam * 0.85);

    // Shallow water is see-through so sand shows; deep water is opaque.
    float alpha = mix(0.25, 1.0, smoothstep(0.0, 3.0, depth));
    alpha = max(alpha, max(fresnel, foam));

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createWater(env: THREE.Texture, depth: THREE.Texture, maxDepth: number) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uEnv: { value: null },
      uDepth: { value: null },
      uTerrainSize: { value: TERRAIN_SIZE },
      uMaxDepth: { value: maxDepth },
    },
  ]);
  // merge() clones values, so assign textures afterward.
  uniforms.uEnv.value = env;
  uniforms.uDepth.value = depth;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
  });

  const geo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}
