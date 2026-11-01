import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { WebGLRenderTarget } from 'three';
import { AOPass } from './ao';

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Aerial perspective + light shafts, in HDR before tone mapping.
 * Fog takes its color from the sky itself (sampled at the horizon in the view direction), so haze turns
 * golden toward the sun and cool away from it. Shafts are a radial blur of visible sky toward the sun.
 */
const AtmosphereShader = {
  name: 'Atmosphere',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tSky: { value: null as THREE.Texture | null },
    tAO: { value: null as THREE.Texture | null },
    uAOStrength: { value: 1 },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunUv: { value: new THREE.Vector2() },
    uSunFacing: { value: 0 },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
    uFogDensity: { value: 0.0004 },
    uFogHeightFalloff: { value: 0.012 },
    uShaftStrength: { value: 0.5 },
    // Valheim's split light: haze turns cyan away from the sun and gold toward it.
    uFogCool: { value: new THREE.Color(0.7, 1.0, 1.18) },
    uFogWarm: { value: new THREE.Color(1.4, 1.0, 0.55) },
    uTintStrength: { value: 0.55 },
    /** 0 in the open, 1 deep in a forest: thicker, more strongly tinted haze and stronger shafts. */
    uForest: { value: 0 },
    // Volumetric sunlight: march each view ray through the sun's shadow map.
    tShadow: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uVolumetric: { value: 1 },
    // Torch glow scattered by the haze around the flame.
    uTorchPos: { value: new THREE.Vector3() },
    uTorchColor: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform samplerCube tSky;
    uniform sampler2D tAO;
    uniform float uAOStrength;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform vec3 uSunDir;
    uniform vec2 uSunUv;
    uniform float uSunFacing;
    uniform vec3 uSunColor;
    uniform float uFogDensity;
    uniform float uFogHeightFalloff;
    uniform float uShaftStrength;
    uniform vec3 uFogCool;
    uniform vec3 uFogWarm;
    uniform float uTintStrength;
    uniform float uForest;
    uniform sampler2DShadow tShadow;
    uniform mat4 uShadowMatrix;
    uniform float uVolumetric;
    uniform vec3 uTorchPos;
    uniform vec3 uTorchColor;
    varying vec2 vUv;

    // Fraction of the first stretch of the ray that sees the sun (1 = no shadow casters along it).
    // Compiled only once the sun's shadow map exists (a shadow sampler can't be bound to an empty texture).
    #ifdef HAS_SHADOW
    float sunVisibility(vec3 origin, vec3 dir, float len) {
      const int STEPS = 28;
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float stepLen = len / float(STEPS);
      float lit = 0.0;
      for (int i = 0; i < STEPS; i++) {
        vec3 p = origin + dir * (float(i) + jitter) * stepLen;
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        vec3 c = sc.xyz / sc.w;
        bool inside = all(greaterThan(c, vec3(0.0))) && all(lessThan(c, vec3(1.0)));
        lit += inside ? texture(tShadow, vec3(c.xy, c.z - 0.0015)) : 1.0;
      }
      return lit / float(STEPS);
    }
    #endif

    vec3 worldFromDepth(vec2 uv, float depth) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = uProjInv * ndc;
      return (uViewInv * vec4(view.xyz / view.w, 1.0)).xyz;
    }

    // Open sky near the sun at a screen position; geometry blocks it. Only sky close to the sun
    // emits, so shafts radiate from the sun rather than washing the whole view.
    float skyLight(vec2 uv) {
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
      float nearSun = 1.0 - smoothstep(0.0, 0.35, length((uv - uSunUv) * vec2(1.0, 0.6)));
      return texture2D(tDepth, uv).x >= 1.0 ? nearSun : 0.0;
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float depth = texture2D(tDepth, vUv).x;
      vec3 camPos = uViewInv[3].xyz;
      // The sky is drawn at exactly depth 1.0 (distant land can reach 0.99998, so no epsilon here).
      bool isSky = depth >= 1.0;
      vec3 world = worldFromDepth(vUv, min(depth, 0.9999999));
      vec3 ray = world - camPos;
      float dist = length(ray);
      ray /= dist;

      if (!isSky) {
        color *= mix(1.0, texture2D(tAO, vUv).r, uAOStrength);
        // Exponential haze, thinner higher up (integrated along the ray).
        float h = max(camPos.y, 0.0);
        float dy = ray.y * dist;
        float heightTerm = abs(dy) > 0.01
          ? (1.0 - exp(-uFogHeightFalloff * dy)) / (uFogHeightFalloff * dy)
          : 1.0;
        // Forests hold a thick haze near the ground (it doesn't thin with height inside the canopy).
        float density = uFogDensity * mix(1.0, 4.0, uForest);
        float optical = density * dist * mix(exp(-uFogHeightFalloff * h) * heightTerm, 1.0, uForest);
        float fog = 1.0 - exp(-optical);
        vec3 horizonDir = normalize(vec3(ray.x, 0.04 + max(ray.y, 0.0) * 0.5, ray.z));
        vec3 fogColor = textureCube(tSky, horizonDir).rgb;
        // The sky near the sun is far brighter than anything on the ground; cap the haze so even a thin layer
        // tints the view instead of washing it out.
        float fogLuma = dot(fogColor, vec3(0.2126, 0.7152, 0.0722));
        // Under the canopy the haze is lit by much less sky, so it's darker.
        fogColor *= 0.75 * min(1.0, 1.4 / max(fogLuma, 1e-4)) * mix(1.0, 0.45, uForest);
        float toSun = max(dot(normalize(vec3(ray.x, 0.0, ray.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
        vec3 tint = mix(uFogCool, uFogWarm, pow(toSun, 2.0));
        fogColor *= mix(vec3(1.0), tint, clamp(uTintStrength + 0.35 * uForest, 0.0, 1.0));
        color = mix(color, fogColor, fog);
      }

      // Volumetric sunlight: haze in sunlit gaps between shadows glows, forming beams through the canopy.
      #ifdef HAS_SHADOW
      if (uVolumetric > 0.0) {
        float marchLen = min(isSky ? 160.0 : dist, 160.0);
        float vis = sunVisibility(camPos, ray, marchLen);
        float cosT = dot(ray, uSunDir);
        // Henyey-Greenstein forward scattering: brightest looking toward the sun.
        float g = 0.65;
        // Capped so staring into the sun doesn't flood the frame; the sky already has its own glow there.
        float phase = min((1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5)), 0.5);
        float density = mix(0.0015, 0.01, uForest);
        float scatter = (1.0 - exp(-density * marchLen)) * phase * 3.0;
        // Only the contrast between lit and shadowed air reads as beams; cap the flat part so open meadows stay clear.
        color += uSunColor * scatter * vis * uVolumetric;
      }
      #endif

      // Torch: analytic in-scattering of a point light in uniform haze (closest-approach formula).
      if (dot(uTorchColor, uTorchColor) > 0.0) {
        float rayLen = isSky ? 60.0 : min(dist, 60.0);
        vec3 toLight = uTorchPos - camPos;
        float tc = dot(toLight, ray);
        float h = max(length(toLight - ray * tc), 0.05);
        float glowAmt = (atan((rayLen - tc) / h) - atan(-tc / h)) / h;
        color += uTorchColor * glowAmt * 0.004 * (1.0 + 1.5 * uForest);
      }

      // Light shafts: march from this pixel toward the sun, collecting unblocked sky.
      if (uSunFacing > 0.0 && uShaftStrength > 0.0) {
        const int SAMPLES = 48;
        vec2 delta = (uSunUv - vUv) / float(SAMPLES);
        vec2 p = vUv;
        float decay = 1.0, shaft = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          p += delta;
          shaft += skyLight(p) * decay;
          decay *= 0.965;
        }
        shaft /= float(SAMPLES);
        float sunAlign = pow(max(dot(ray, uSunDir), 0.0), 3.0);
        color += uSunColor * shaft * sunAlign * uSunFacing * uShaftStrength * (1.0 + 1.5 * uForest);
      }

      // The sky's sun disc is orders of magnitude brighter than anything else; cap it so bloom
      // stays a glow instead of a full-screen veil. Tone mapping saturates these values anyway.
      gl_FragColor = vec4(min(color, vec3(6.6)), 1.0);
    }
  `,
};

/** Display-space grade after tone mapping: warm highlights, teal shadows, saturation, contrast, vignette. */
const GradeShader = {
  name: 'Grade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1.18 },
    uContrast: { value: 1.14 },
    uWarmth: { value: 0.04 },
    uVignette: { value: 0.28 },
  },
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split toning.
      c += uWarmth * vec3(0.9, 0.45, -0.3) * smoothstep(0.45, 1.0, l);
      c += uWarmth * vec3(-0.35, 0.1, 0.25) * (1.0 - smoothstep(0.0, 0.4, l));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.0, 0.8)));
      c *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

/** ShaderPass that also hands the scene depth buffer to its shader. */
class DepthShaderPass extends ShaderPass {
  /** Runs just before drawing, after the scene (and its shadow maps) has rendered this frame. */
  beforeRender?: () => void;

  render(renderer: THREE.WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.beforeRender?.();
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sky: THREE.Texture,
  sun: THREE.DirectionalLight,
) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  const composer = new EffectComposer(renderer, target);
  // A composer built around an explicit target assumes pixel ratio 1; restore the renderer's.
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  composer.addPass(new RenderPass(scene, camera));
  const ao = new AOPass(camera);
  composer.addPass(ao);
  const atmosphere = new DepthShaderPass(AtmosphereShader);
  atmosphere.uniforms.tSky.value = sky;
  atmosphere.uniforms.tAO.value = ao.texture;
  // The sun's shadow map only exists after the first scene render, so hook it up from inside the pass.
  atmosphere.beforeRender = () => {
    const depth = sun.shadow.map?.depthTexture;
    if (depth && atmosphere.uniforms.tShadow.value !== depth) {
      atmosphere.uniforms.tShadow.value = depth;
      atmosphere.material.defines.HAS_SHADOW = '';
      atmosphere.material.needsUpdate = true;
    }
    atmosphere.uniforms.uShadowMatrix.value.copy(sun.shadow.matrix);
  };
  composer.addPass(atmosphere);
  // Small, tight bloom on the brightest highlights only; a wide radius lets the sky near the sun
  // spill a milky veil over the whole frame.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.06, 0.35, 6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const sunWorld = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  return {
    composer,
    atmosphere: atmosphere.uniforms,
    ao: ao.uniforms,
    bloom,
    grade: grade.uniforms,
    setSize(width: number, height: number) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    render(sunDir: THREE.Vector3, sunColor: THREE.Color) {
      const u = atmosphere.uniforms;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uSunDir.value.copy(sunDir);
      u.uSunColor.value.copy(sunColor);
      sunWorld.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      u.uSunUv.value.set(sunWorld.x * 0.5 + 0.5, sunWorld.y * 0.5 + 0.5);
      camera.getWorldDirection(camDir);
      // Fade shafts out as the sun leaves the view instead of popping.
      u.uSunFacing.value = THREE.MathUtils.smoothstep(camDir.dot(sunDir), 0.0, 0.5);
      composer.render();
    },
  };
}
