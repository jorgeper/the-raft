import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VibeShader, applyVibe, type VibeName } from './vibes';
import type { WebGLRenderTarget } from 'three';
import { AOPass } from './ao';
import { CLOUD_NOISE, CLOUD_HEIGHT } from './sky';
import { WaterPass, type Water } from './water';
import { RAINBOW } from './weather';
import { TAAPass } from './taa';
import type { SunShadows } from './cascades';
import { VolumetricPass, VIS_UPSAMPLE } from './volumetric';
import type { CloudPass } from './clouds';
import { LuminancePass } from './exposure';
import { MotionPass } from './motion';

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
    /** 0 when the quality preset turns AO off (its texture is then stale). */
    uAOOn: { value: 1 },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunUv: { value: new THREE.Vector2() },
    uSunFacing: { value: 0 },
    /** 1 by day; the flare ghosts belong to the sun, not the moon (the light direction at night). */
    uFlareOn: { value: 1 },
    /** Night vision through the rods: dim surfaces lose their color and turn silver-blue (main.ts: 0 by day). */
    uScotopic: { value: 0 },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
    /** 0..1 how strong a rainbow stands opposite the sun (weather.ts). */
    uRainbow: { value: 0 },
    uFogDensity: { value: 0.00045 },
    uFogHeightFalloff: { value: 0.012 },
    uShaftStrength: { value: 0.5 },
    // Valheim's split light: haze turns cyan away from the sun and gold toward it.
    uFogCool: { value: new THREE.Color(0.7, 1.0, 1.18) },
    uFogWarm: { value: new THREE.Color(1.4, 1.0, 0.55) },
    uTintStrength: { value: 0.75 },
    /** Valheim's hue split: lilac-pink between the cool and warm haze, and orange (not white-gold) scattered sun. */
    uHueSplit: { value: 1 },
    /** How far shade (out of the sun) shifts toward teal-blue. */
    uShadeTint: { value: 0.6 },
    /** Gold glow of the haze between you and the sun. */
    uForwardGlow: { value: 1 },
    /** Soft cap on the sky's brightest channel after the haze adds to it (matches sky.ts's uSkyKnee/uSkyCeil). */
    uSkyKnee: { value: 1.0 },
    uSkyCeil: { value: 1.6 },
    /** 0 in the open, 1 deep in a forest: thicker, more strongly tinted haze and stronger shafts. */
    uForest: { value: 0 },
    // Volumetric sunlight: how much of each view ray sees the sun, marched at half resolution (`VolumetricPass`).
    tVis: { value: null as THREE.Texture | null },
    uVisTexel: { value: new THREE.Vector2(1, 1) },
    /** 0 until the sun's shadow map exists (visibility is then 1 everywhere). */
    uVisOn: { value: 0 },
    // Volumetric clouds (half resolution, `CloudPass`): rgb scattered light, a transmittance.
    tClouds: { value: null as THREE.Texture | null },
    uCloudsOn: { value: 0 },
    uVolumetric: { value: 1 },
    // Torch glow scattered by the haze around the flame.
    uTorchPos: { value: new THREE.Vector3() },
    uTorchColor: { value: new THREE.Color(0, 0, 0) },
    /** 0 = natural; up to 1 (or beyond) = Valheim's dreamy look: thicker two-tone haze, stronger beams, flares. */
    uWhimsy: { value: 0 },
    // Ground fog: a layer hugging the terrain, thickest in hollows, broken into drifting patches.
    uGroundFog: { value: 0.22 },
    uGroundFogHeight: { value: 3 },
    uGroundFogPatchy: { value: 0.6 },
    /** Terrain height under the camera: the fog layer's base. */
    uGroundY: { value: 0 },
    uTime: { value: 0 },
    // Cloud shadows: the sky's cloud field projected down the sun direction onto the land.
    /** Shifts the per-pixel noise every frame so TAA averages it away (0 without TAA). */
    uNoiseOffset: { value: 0 },
    uClouds: { value: 0.38 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudShadow: { value: 0.5 },
    /** Debug: 1 shows the volumetric sun-visibility term in gray. */
    uDebugVolumetric: { value: 0 },
  },
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform samplerCube tSky;
    uniform sampler2D tAO;
    uniform float uAOStrength;
    uniform float uAOOn;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform vec3 uSunDir;
    uniform vec2 uSunUv;
    uniform float uSunFacing;
    uniform float uFlareOn;
    uniform float uScotopic;
    uniform vec3 uSunColor;
    uniform float uRainbow;
    ${RAINBOW}
    uniform float uFogDensity;
    uniform float uFogHeightFalloff;
    uniform float uShaftStrength;
    uniform vec3 uFogCool;
    uniform vec3 uFogWarm;
    uniform float uTintStrength;
    uniform float uForwardGlow;
    uniform float uSkyKnee;
    uniform float uSkyCeil;
    uniform float uForest;
    uniform float uVolumetric;
    uniform vec3 uTorchPos;
    uniform vec3 uTorchColor;
    uniform float uWhimsy;
    uniform float uHueSplit;
    uniform float uShadeTint;
    uniform float uGroundFog;
    uniform float uGroundFogHeight;
    uniform float uGroundFogPatchy;
    uniform float uGroundY;
    uniform float uTime;
    uniform float uDebugVolumetric;
    uniform float uNoiseOffset;
    uniform float uClouds;
    uniform vec2 uCloudOffset;
    uniform float uCloudShadow;
    uniform float uVisOn;
    uniform sampler2D tClouds;
    uniform float uCloudsOn;
    varying vec2 vUv;
    ${VIS_UPSAMPLE}
    ${CLOUD_NOISE}

    // How much a cloud shades this point: follow the sun ray up to the cloud layer and read the cover there.
    float cloudShade(vec3 p) {
      if (uClouds <= 0.0 || uCloudShadow <= 0.0 || uSunDir.y <= 0.02) return 1.0;
      vec3 q = p + uSunDir * ((${CLOUD_HEIGHT.toFixed(1)} - p.y) / max(uSunDir.y, 0.08));
      vec2 uv = (q.xz - uViewInv[3].xz) / ${CLOUD_HEIGHT.toFixed(1)} * 0.9 + uCloudOffset;
      // Shadows are softer than the clouds' edges: light wraps around them.
      float cover = smoothstep(0.05, 0.6, cloudCover(uv, uClouds));
      return 1.0 - uCloudShadow * cover * smoothstep(0.02, 0.15, uSunDir.y);
    }

    float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float gNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
    }

    vec3 worldFromDepth(vec2 uv, float depth) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = uProjInv * ndc;
      return (uViewInv * vec4(view.xyz / view.w, 1.0)).xyz;
    }

    // Open sky near the sun at a screen position; geometry and clouds block it. Only sky close to the sun
    // emits, so shafts radiate from the sun rather than washing the whole view. Through the gaps in broken cloud
    // they fan out as crepuscular rays (the clouds' transmittance, raised to sharpen the gaps).
    float skyLight(vec2 uv) {
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
      float nearSun = 1.0 - smoothstep(0.0, 0.35, length((uv - uSunUv) * vec2(1.0, 0.6)));
      if (texture2D(tDepth, uv).x < 1.0) return 0.0;
      float clear = uCloudsOn > 0.5 ? pow(texture2D(tClouds, uv).a, 1.5) : 1.0;
      return nearSun * clear;
    }

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec3 color = scene.rgb;
      float depth = texture2D(tDepth, vUv).x;
      vec3 camPos = uViewInv[3].xyz;
      // The sky is drawn at exactly depth 1.0 (distant land can reach 0.99998, so no epsilon here).
      bool isSky = depth >= 1.0;
      vec3 world = worldFromDepth(vUv, min(depth, 0.9999999));
      vec3 ray = world - camPos;
      float dist = length(ray);
      ray /= dist;

      // How much of the air along this ray sees the sun (1 without a shadow map). Used twice: shadowed air keeps
      // the haze darker, and lit air adds in-scattered sunlight, so the gaps between crowns become beams.
      float marchLen = marchLength(isSky, dist);
      vec3 visTriple = uVisOn > 0.5 && uVolumetric > 0.0 ? upsampleVis(vUv, marchLen) : vec3(1.0);
      vec2 visPair = visTriple.xy;
      float cloudLit = visTriple.z;
      float vis = visPair.x;
      float sunUpV = smoothstep(-0.05, 0.08, uSunDir.y);
      // Sunlight scattered by the haze has come a long way through it, so it reaches the eye orange rather than
      // white-gold: a saturated version of the sun's color (luma kept), deeper in forests' thick air.
      vec3 scatterColor = uSunColor * mix(vec3(1.0), vec3(1.3, 0.86, 0.5), uHueSplit * mix(0.6, 1.0, uForest) * (1.0 - uScotopic));

      if (isSky && uCloudsOn > 0.5) {
        // A small tent filter over the half-res march: its per-pixel jitter reads as stripes when sampled raw.
        vec2 ct = 1.0 / vec2(textureSize(tClouds, 0));
        vec4 cl = texture2D(tClouds, vUv) * 0.4
          + (texture2D(tClouds, vUv + vec2(ct.x, ct.y)) + texture2D(tClouds, vUv + vec2(-ct.x, ct.y))
          + texture2D(tClouds, vUv + vec2(ct.x, -ct.y)) + texture2D(tClouds, vUv - ct)) * 0.15;
        color = color * cl.a + cl.rgb;
      }
      // The rainbow hangs in the rain between you and the far land, in front of the clouds; drawn here, after them.
      if (uRainbow > 0.0 && ray.y > -0.1) {
        float reach = isSky ? 1.0 : smoothstep(120.0, 400.0, dist);
        float sunLuma = dot(uSunColor, vec3(0.2126, 0.7152, 0.0722));
        color += rainbow(ray, uSunDir) * uRainbow * reach * sunLuma * 1.3 * smoothstep(-0.1, 0.03, ray.y);
      }
      // The sky as drawn (and capped in sky.ts); the sun disc is the only part far above the cap.
      float skyPeak = max(max(color.r, color.g), color.b);

      float shade = isSky ? 1.0 : cloudShade(world);
      if (!isSky) {
        color *= mix(1.0, texture2D(tAO, vUv).r, uAOStrength * uAOOn);
        color *= shade;
        // Moonlit night: under dim light the eye sees with its rods, so color drains away and what's left reads
        // silver-blue (the Purkinje shift). Bright light (the torch, a lit window of sky) stays in color.
        if (uScotopic > 0.0) {
          float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
          float rod = uScotopic * (1.0 - smoothstep(0.015, 0.2, lum));
          // Firelight keeps its warmth: the torch's pool of light is seen in color.
          if (dot(uTorchColor, uTorchColor) > 0.0) rod *= smoothstep(5.0, 16.0, distance(world, uTorchPos));
          color = mix(color, lum * vec3(0.82, 0.95, 1.16), rod * 0.6);
        }
        // Valheim's shade is blue-teal: what the sun doesn't reach is lit by the sky alone. Shift its hue (luma
        // kept) toward teal, more under a forest canopy. Cloud shadow counts as shade too.
        float inShade = (1.0 - visPair.y * shade) * sunUpV;
        // Kept moderate (and no stronger under trees): forests are nearly all shade, and a strong tint there read as
        // a blue fog the haze sliders couldn't clear.
        float shadeK = uShadeTint * inShade;
        color *= mix(vec3(1.0), vec3(0.74, 1.0, 1.45), clamp(shadeK, 0.0, 1.0));
        // Our shade is close to black, where a hue shift barely shows; Valheim's is a luminous teal. Lift it with a
        // little teal skylight, scaled by how bright the sky overhead is (so dusk shade stays dark).
        float skyUp = dot(textureCube(tSky, vec3(0.0, 1.0, 0.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
        color += vec3(0.3, 0.75, 1.0) * skyUp * 0.04 * shadeK;
        // Exponential haze, thinner higher up (integrated along the ray).
        float h = max(camPos.y, 0.0);
        float dy = ray.y * dist;
        float heightTerm = abs(dy) > 0.01
          ? (1.0 - exp(-uFogHeightFalloff * dy)) / (uFogHeightFalloff * dy)
          : 1.0;
        // Forests hold a thick haze near the ground (it doesn't thin with height inside the canopy).
        // Whimsy thickens the air, so tree rows behind each other fade into flat colored layers.
        // The forest's thick air only fills the first stretch of the ray: standing among trees at a clearing's or
        // a gorge's rim, the open air beyond is ordinary haze (inside a forest, trunks hide anything farther anyway).
        float base = uFogDensity * (1.0 + 0.5 * uWhimsy);
        float openTerm = exp(-uFogHeightFalloff * h) * heightTerm;
        float near = min(dist, 70.0);
        float optical = base * (mix(1.0, 7.0, uForest) * mix(openTerm, 1.0, uForest) * near + openTerm * (dist - near));
        float fog = 1.0 - exp(-optical);
        vec3 horizonDir = normalize(vec3(ray.x, 0.04 + max(ray.y, 0.0) * 0.5, ray.z));
        vec3 fogColor = textureCube(tSky, horizonDir).rgb;
        // The sky near the sun is far brighter than anything on the ground; cap the haze so even a thin layer
        // tints the view instead of washing it out.
        float fogLuma = dot(fogColor, vec3(0.2126, 0.7152, 0.0722));
        // Under the canopy the haze is lit by much less sky, so it's darker.
        // Valheim's haze is luminous, close to the horizon sky's brightness, so distant land dissolves into light.
        fogColor *= 0.85 * min(1.0, 2.3 / max(fogLuma, 1e-4)) * mix(1.0, 0.5, uForest);
        float toSun = max(dot(normalize(vec3(ray.x, 0.0, ray.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
        // Whimsy splits the haze harder: saturated teal away from the sun, orange-pink toward it.
        vec3 cool = mix(uFogCool, vec3(0.42, 0.98, 1.4), clamp(uWhimsy, 0.0, 1.0));
        vec3 warm = mix(uFogWarm, vec3(1.75, 0.82, 0.62), clamp(uWhimsy, 0.0, 1.0));
        float warmW = pow(toSun, mix(2.0, 1.4, clamp(uWhimsy, 0.0, 1.0)));
        vec3 tint = mix(cool, warm, warmW);
        // At night the light is the moon's: the haze toward it is silver, not sunset orange.
        tint = mix(tint, vec3(0.78, 0.92, 1.2), uScotopic * 0.85);
        // A lilac-pink stop between teal and gold (an RGB blend of the two is grey), so the haze runs
        // blue -> violet-pink -> orange around the view, as Valheim's does.
        tint *= mix(vec3(1.0), vec3(1.2, 0.84, 1.02), uHueSplit * 4.0 * warmW * (1.0 - warmW));
        fogColor *= mix(vec3(1.0), tint, clamp(uTintStrength + 0.5 * uForest + 0.45 * uWhimsy, 0.0, 1.0));
        // Forward scattering: haze between you and a low sun glows gold (and orange under the canopy).
        float sunLow = 1.0 - smoothstep(0.1, 0.7, uSunDir.y);
        // A tight lobe: a warm glow around the sun, not a white-out across half the view.
        float forward = pow(max(dot(ray, uSunDir), 0.0), 9.0) * (0.5 + 1.2 * sunLow) * (1.0 + 0.6 * uForest);
        fogColor += scatterColor * forward * smoothstep(-0.06, 0.04, uSunDir.y) * 1.3 * uForwardGlow;
        // Even toward the sun the haze stays a colored glow rather than clipping to white.
        float fogPeak = dot(fogColor, vec3(0.2126, 0.7152, 0.0722));
        fogColor *= min(1.0, 3.2 / max(fogPeak, 1e-4));
        // Haze in the canopy's shadow is darker than haze in the sun (strongest in forests, a hint elsewhere).
        fogColor *= mix(1.0, 0.3 + 0.7 * vis, (0.25 + 0.65 * uForest) * sunUpV * min(uVolumetric, 1.0));
        color = mix(color, fogColor, fog);

        // Ground fog: exponential in height above the ground under the camera, integrated along the ray, so it
        // lies low over the land and pools in hollows; drifting noise along the ray breaks it into banks.
        if (uGroundFog > 0.0) {
          float H = uGroundFogHeight;
          float L = min(dist, 500.0);
          // Heights are measured from the ground under the camera, so anything lower reads as deep in the mist.
          // A little below that pools it in hollows; the old floor of 3 layer heights (20x as dense) filled a
          // whole gorge or valley seen from its rim with a wall of fog.
          float y0 = max(camPos.y - uGroundY, -0.7 * H);
          float y1 = max(camPos.y + ray.y * L - uGroundY, -0.7 * H);
          float dy = y1 - y0;
          float integral = abs(dy) > 0.01 ? L * H / dy * (exp(-y0 / H) - exp(-y1 / H)) : L * exp(-y0 / H);
          float n = 0.0;
          for (int k = 0; k < 3; k++) {
            vec3 q = camPos + ray * L * (0.12 + 0.36 * float(k));
            n += gNoise(q.xz * 0.03 + uTime * vec2(0.025, 0.01)) * 0.65 + gNoise(q.xz * 0.11 - uTime * vec2(0.01, 0.03)) * 0.35;
          }
          float patches = mix(1.0, smoothstep(0.3, 0.75, n / 3.0) * 2.0, uGroundFogPatchy);
          // Mist lies thick at dawn and dusk and burns off as the sun climbs.
          float burnOff = mix(1.0, 0.3, smoothstep(0.12, 0.55, uSunDir.y));
          float g = 1.0 - exp(-uGroundFog * 0.012 * integral * patches * (1.0 + 0.5 * uWhimsy) * burnOff);
          // Low mist is lit like the haze but milkier, and dimmer than the bright haze toward the sun, so a meadow
          // looking into a low sun keeps its shapes.
          vec3 mist = mix(fogColor, vec3(dot(fogColor, vec3(0.333))), 0.25);
          float mistLuma = dot(mist, vec3(0.2126, 0.7152, 0.0722));
          mist *= min(1.0, 1.6 / max(mistLuma, 1e-4));
          color = mix(color, mist, g);

          // Water mist: a thin layer hugging sea and river level (y = 0) rather than the ground under the viewer,
          // drawn into long wisps that drift over the water. (Clamped at the surface: the ray may run on down
          // to the riverbed.)
          float Hw = 1.3;
          float Lw = min(dist, 300.0);
          float w0 = max(camPos.y, 0.0), w1 = max(camPos.y + ray.y * Lw, 0.0);
          float dw = w1 - w0;
          float wIntegral = abs(dw) > 0.01 ? Lw * Hw / dw * (exp(-w0 / Hw) - exp(-w1 / Hw)) : Lw * exp(-w0 / Hw);
          float wisps = 0.0;
          for (int k = 0; k < 3; k++) {
            vec3 q = camPos + ray * Lw * (0.15 + 0.35 * float(k));
            vec2 st = q.xz * vec2(0.035, 0.12) + uTime * vec2(0.05, 0.012);
            wisps += smoothstep(0.35, 0.8, gNoise(st) * 0.7 + gNoise(q.xz * 0.2 + uTime * vec2(-0.02, 0.04)) * 0.3);
          }
          float gw = 1.0 - exp(-uGroundFog * 0.08 * wIntegral * (0.2 + wisps * 0.8) * burnOff * burnOff);
          color = mix(color, mist, gw);
        }
      }

      // Volumetric sunlight: haze in sunlit gaps between shadows glows, forming beams through the canopy.
      if (uVisOn > 0.5 && uVolumetric > 0.0) {
        float cosT = dot(ray, uSunDir);
        // Henyey-Greenstein forward scattering (brightest toward the sun) plus a broad lobe, so beams also show
        // from the side, slanting between the trunks.
        float g = 0.65;
        float hg = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
        // Capped so staring into the sun doesn't flood the frame; the sky already has its own glow there.
        // The broad lobe is what makes beams read side-on; whimsy widens it further.
        // The forest's strong scatter is tuned for air that is mostly shaded, where it draws bright beams between
        // dark stretches. Where the sun reaches under the canopy (a clearing, a forest edge, a low sun) nearly all
        // the air is lit; there it painted the forest's beam glow over every pixel and washed the view out to white.
        // So the beams fall back to open air's thin glow as the air around this pixel turns lit.
        float beamForest = uForest * (1.0 - smoothstep(0.4, 0.85, litAround(vUv)));
        float phase = min(hg + mix(0.03, 0.3, beamForest) * (1.0 + 0.6 * uWhimsy), mix(0.5, 0.75, beamForest));
        // Beams are sunlight scattered by the haze, so they follow the haze slider: no haze, clear air, no veil.
        // (At the default haze, 0.00045, the factor is 1.) Open air's share is thin, so the view toward a low sun
        // isn't veiled; the forest's thick air keeps its strong beams.
        float hazeK = clamp(uFogDensity / 0.00045, 0.0, 3.0);
        float density = mix(0.001, 0.024, beamForest) * (1.0 + 0.5 * uWhimsy) * hazeK;
        float scatter = (1.0 - exp(-density * marchLen)) * phase * mix(3.0, 5.5, beamForest);
        // Beams read from the contrast between lit and shadowed air: pow() deepens the shadowed stretches.
        // (The half-res march is smooth enough to take a harder curve without breaking into noise.)
        float beam = scatter * pow(vis, 2.0) * (1.0 + 0.5 * uWhimsy);
        // Soft ceiling, a second guard against a white veil (looking into a low sun every step is lit). The knee
        // leaves the dim, shaded range nearly linear, so beams keep their contrast against it.
        const float BEAM_MAX = 0.8;
        beam = BEAM_MAX * (1.0 - exp(-beam / BEAM_MAX));
        color += scatterColor * beam * uVolumetric * sunUpV * cloudShade(camPos);

        // Crepuscular rays: under broken cloud the long stretch of air out to the horizon is lit in shafts and
        // shadowed in others. Lit air glows a little more, shadowed air a little less, around the haze's average,
        // so rays fan from the gaps (strongest toward the sun, faint from the side).
        float rayK = smoothstep(0.08, 0.3, uClouds) * (1.0 - smoothstep(0.75, 0.95, uClouds)) * (1.0 - uForest);
        if (rayK > 0.0) {
          float gR = 0.7;
          float hgR = (1.0 - gR * gR) / (4.0 * 3.14159 * pow(1.0 + gR * gR - 2.0 * gR * cosT, 1.5)) + 0.04;
          float L = isSky ? 3000.0 : min(dist, 3000.0);
          float godFog = 1.0 - exp(-uFogDensity * (1.0 + 0.5 * uWhimsy) * 1.5 * L);
          float shaft = smoothstep(0.25, 0.9, cloudLit) - 0.5;
          float k = min(hgR, 1.2) * godFog * rayK * uVolumetric * sunUpV * (1.0 + 0.5 * uWhimsy);
          // Lit shafts add sunlight; shadowed ones dim what's behind them, hue kept (subtracting the orange scatter
          // color left saturated blue holes).
          color += scatterColor * max(shaft, 0.0) * 5.0 * k;
          color *= 1.0 - min(-min(shaft, 0.0) * 1.6 * k, 0.55);
        }
        if (uDebugVolumetric > 1.5) { gl_FragColor = vec4(vec3(cloudLit), 1.0); return; }
        if (uDebugVolumetric > 0.5) { gl_FragColor = vec4(vec3(vis), 1.0); return; }
      }

      // Torch: analytic in-scattering of a point light in uniform haze (closest-approach formula).
      if (dot(uTorchColor, uTorchColor) > 0.0) {
        float rayLen = isSky ? 60.0 : min(dist, 60.0);
        vec3 toLight = uTorchPos - camPos;
        float tc = dot(toLight, ray);
        float h = max(length(toLight - ray * tc), 0.05);
        float glowAmt = (atan((rayLen - tc) / h) - atan(-tc / h)) / h;
        color += uTorchColor * glowAmt * 0.0018 * (1.0 + 1.2 * uForest);
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
        color += scatterColor * shaft * sunAlign * uSunFacing * uShaftStrength * (1.0 + 1.5 * uForest) * (1.0 + 0.5 * uWhimsy)
          * clamp(uFogDensity / 0.00045, 0.0, 3.0);
      }

      // Lens flare ghosts strung along the line from the sun through the screen center, when the sun is visible.
      if (uWhimsy > 0.0 && uSunFacing > 0.0 && uFlareOn > 0.0) {
        float seen = 0.0;
        for (int k = 0; k < 5; k++) {
          vec2 o = vec2(cos(float(k) * 1.256), sin(float(k) * 1.256)) * 0.012;
          seen += skyLight(uSunUv + o * float(k > 0));
        }
        seen /= 5.0;
        if (seen > 0.0) {
          vec3 flare = vec3(0.0);
          // position along the axis (0 = sun, 1 = mirrored), radius, color
          float ts[5] = float[5](0.55, 0.8, 1.15, 1.45, 1.8);
          float rs[5] = float[5](0.035, 0.07, 0.025, 0.11, 0.05);
          vec3 cs[5] = vec3[5](vec3(1.0, 0.6, 0.3), vec3(0.4, 0.9, 1.0), vec3(1.0, 0.45, 0.8), vec3(0.5, 1.0, 0.6), vec3(0.9, 0.7, 1.0));
          for (int k = 0; k < 5; k++) {
            vec2 c = mix(uSunUv, vec2(1.0) - uSunUv, ts[k]);
            float d = length((vUv - c) * vec2(1.7778, 1.0));
            // Soft discs with a slightly brighter rim, like aperture ghosts.
            float disc = smoothstep(rs[k], rs[k] * 0.7, d) * (0.6 + 0.4 * smoothstep(rs[k] * 0.5, rs[k], d));
            flare += cs[k] * disc;
          }
          color += flare * uSunColor * seen * uSunFacing * uWhimsy * 0.18 * uFlareOn;
        }
      }

      // The sky's sun disc is orders of magnitude brighter than anything else; cap it so bloom
      // stays a glow instead of a full-screen veil. Tone mapping saturates these values anyway.
      // Alpha carries the wind motion on to the TAA (see MOTION_SCALE in wind.ts); the sky has none.
      // Beams, shafts and glow add on top of the sky near the sun; cap the sum the way sky.ts caps the sky, hue
      // kept, so it stays a colored glow instead of a milky veil. The sun disc itself keeps its brightness for bloom.
      if (isSky) {
        float peak = max(max(color.r, color.g), color.b);
        float over = max(peak - uSkyKnee, 0.0);
        vec3 capped = color * (min(peak, uSkyKnee) + over / (1.0 + over / max(uSkyCeil - uSkyKnee, 1e-3))) / max(peak, 1e-4);
        color = mix(capped, color, smoothstep(2.5, 5.0, skyPeak));
      }
      gl_FragColor = vec4(min(color, vec3(6.6)), isSky ? 1.0 : scene.a);
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
    uWhimsy: { value: 0 },
    /** Filmic S-curve: deeper shadows and brighter lights without clipping either end. */
    uDepth: { value: 0.35 },
    /** Three-way color: blue-cyan shadows, a touch of pink in the mids, orange-gold highlights. */
    uColorRichness: { value: 0.5 },
    /** Lifts the deepest shade so dark scenes stay readable (main.ts sets it from "see in the dark"). */
    uShadowLift: { value: 0.45 },
    /** 1 at night: the saturation push and teal shadow tint ease off, so the night sky reads deep navy, not neon. */
    uNight: { value: 0 },
  },
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDepth;
    uniform float uColorRichness;
    uniform float uShadowLift;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uVignette;
    uniform float uWhimsy;
    uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split toning: gold highlights, teal shadows (pushed further by whimsy).
      float warmth = uWarmth + 0.06 * uWhimsy;
      c += warmth * vec3(0.9, 0.45, -0.3) * smoothstep(0.45, 1.0, l);
      c += (warmth + 0.05 * uWhimsy) * vec3(-0.35, 0.1, 0.25) * (1.0 - smoothstep(0.0, 0.4, l)) * (1.0 - 0.7 * uNight);
      c = mix(vec3(l), c, mix(uSaturation + 0.18 * uWhimsy, 0.9, uNight));
      c = (c - 0.5) * uContrast + 0.5;
      // The teal shadow tint and the saturation push can drive a channel below zero in very dark blues (night sky,
      // a far island at night). Left negative, the luminance below came out <= 0 and the S-curve's ratio then
      // multiplied the pixel to black: cloud-shaped black holes in the night sky.
      c = max(c, vec3(0.0));
      // S-curve on luminance (hue and saturation kept), so shade gets richer and highlights glow.
      float lc = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      // Full strength in the shade, half in the highlights, so bright skies don't lift toward white.
      float ls = mix(lc, lc * lc * (3.0 - 2.0 * lc), uDepth * (lc < 0.5 ? 1.0 : 0.5));
      // Shadow lift: a toe that raises the darkest tones most (about doubling near black), fading out by the mids,
      // so night and deep forest stay legible without greying the rest of the frame.
      ls += uShadowLift * ls * pow(1.0 - ls, 5.0) * 2.0;
      c *= ls / max(lc, 1e-4);
      // Three-way grade, weighted by luminance band so every frame holds cool shade, rosy mids and warm light.
      float k = uColorRichness * (1.0 + 0.5 * uWhimsy);
      float shadowW = 1.0 - smoothstep(0.05, 0.4, ls);
      float midW = smoothstep(0.15, 0.45, ls) * (1.0 - smoothstep(0.5, 0.85, ls));
      float highW = smoothstep(0.55, 0.95, ls);
      c += k * (shadowW * vec3(-0.035, 0.012, 0.06) + midW * vec3(0.03, -0.012, 0.018) + highW * vec3(0.05, 0.012, -0.045));
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
  sun: SunShadows,
  /** Drawn after the haze (unfogged), e.g. glowing motes; its materials test against `sceneDepth` themselves. */
  overlay?: THREE.Scene,
  /** Translucent water, drawn over the opaque scene before AO and haze. */
  water?: Water,
  /** Volumetric clouds, composited over the sky by the haze pass. */
  clouds?: CloudPass,
  /** Groups whose meshes move on their own (character, animals), for the TAA's motion vectors. */
  movers: () => (THREE.Object3D | null | undefined)[] = () => [],
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
  const waterPass = water ? new WaterPass(water, camera) : null;
  if (waterPass) composer.addPass(waterPass);
  const ao = new AOPass(camera);
  composer.addPass(ao);
  const volumetric = new VolumetricPass(camera, sun);
  composer.addPass(volumetric);
  if (clouds) composer.addPass(clouds);
  const atmosphere = new DepthShaderPass(AtmosphereShader);
  atmosphere.uniforms.tSky.value = sky;
  atmosphere.uniforms.tAO.value = ao.texture;
  atmosphere.uniforms.tVis.value = volumetric.texture;
  atmosphere.beforeRender = () => {
    atmosphere.uniforms.uVisOn.value = volumetric.enabled && volumetric.ready ? 1 : 0;
    atmosphere.uniforms.uVisTexel.value.copy(volumetric.texel);
    atmosphere.uniforms.uCloudsOn.value = clouds?.enabled ? 1 : 0;
  };
  if (clouds) atmosphere.uniforms.tClouds.value = clouds.texture;
  composer.addPass(atmosphere);
  const taa = new TAAPass(camera, target.depthTexture!);
  // Drawn after the scene (it needs the frame's bone poses) and before the TAA that reads it.
  const motion = new MotionPass(camera, taa, movers);
  taa.motion = motion.target.texture;
  composer.insertPass(motion, 1);
  composer.addPass(taa);
  // Meters the finished HDR frame for eye adaptation (main.ts turns it into exposure).
  const luminance = new LuminancePass();
  composer.addPass(luminance);
  if (overlay) {
    const overlayPass = new RenderPass(overlay, camera);
    overlayPass.clear = false;
    composer.addPass(overlayPass);
  }
  // Small, tight bloom on the brightest highlights only; a wide radius lets the sky near the sun
  // spill a milky veil over the whole frame.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.06, 0.35, 6);
  composer.addPass(bloom);
  // Whimsy's dreamy diffusion: a wide, soft glow from everything bright, not just the sun.
  // Thresholded above the sky's own brightness, so the sun doesn't balloon; lit foliage and haze glow.
  const glow = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0, 0.7, 4.2);
  glow.enabled = false;
  composer.addPass(glow);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  // The chosen vibe's grade on top (off for the whimsical look, so that stays exactly as tuned).
  const vibe = new ShaderPass(VibeShader);
  vibe.enabled = false;
  composer.addPass(vibe);

  let whimsy = 0, glowAllowed = true, beamsAllowed = true, noiseFrame = 0;
  const applyGlow = () => {
    glow.enabled = glowAllowed && whimsy > 0.01;
    glow.strength = 0.07 * whimsy;
  };
  const sunWorld = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  return {
    composer,
    atmosphere: atmosphere.uniforms,
    ao: ao.uniforms,
    bloom,
    /** The scene's depth (land, trees, grass; not the water), for overlay materials that must hide behind geometry. */
    sceneDepth: waterPass ? waterPass.depth : target.depthTexture!,
    grade: grade.uniforms,
    vibe: vibe.uniforms,
    /** Switches to a precanned color mood (vibes.ts); 'whimsical' is the tuned look with the vibe pass off. */
    setVibe(name: VibeName) {
      vibe.enabled = applyVibe(vibe.uniforms as typeof VibeShader.uniforms, name);
    },
    taa,
    motion,
    /** The frame's metered brightness (geometric mean of HDR luminance, before exposure). */
    luminance,
    /** 0 = natural look; higher = dreamier (haze split, beams, flares, glow, grade). */
    setWhimsy(w: number) {
      atmosphere.uniforms.uWhimsy.value = w;
      grade.uniforms.uWhimsy.value = w;
      whimsy = w;
      applyGlow();
    },
    /** Quality preset knobs: volumetric march steps, AO resolution (0 = off), glow pass, cloud steps (0 = off). */
    setQuality(volumetricSteps: number, aoScale: number, glowOn: boolean, cloudSteps = 0) {
      volumetric.setSteps(volumetricSteps * 2);
      clouds?.setSteps(cloudSteps);
      ao.enabled = aoScale > 0;
      atmosphere.uniforms.uAOOn.value = aoScale > 0 ? 1 : 0;
      if (aoScale > 0) ao.setScale(aoScale);
      glowAllowed = glowOn;
      applyGlow();
    },
    /** Performance switches: sunbeams (the shadow-map march), the bloom on highlights, and per-object motion vectors. */
    setEffects(beams: boolean, bloomOn: boolean, motionOn: boolean) {
      beamsAllowed = beams;
      bloom.enabled = bloomOn;
      motion.enabled = motionOn;
      taa.motion = motionOn ? motion.target.texture : null;
    },
    setSize(width: number, height: number) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    render(sunDir: THREE.Vector3, sunColor: THREE.Color) {
      taa.jitter();
      const u = atmosphere.uniforms;
      noiseFrame = (noiseFrame + 1) % 64;
      const noise = taa.enabled ? (noiseFrame * 0.618034) % 1 : 0;
      u.uNoiseOffset.value = noise;
      volumetric.uniforms.uNoiseOffset.value = noise;
      if (clouds) clouds.noiseOffset = noise;
      volumetric.uniforms.uForest.value = u.uForest.value;
      volumetric.uniforms.uSunDir.value.copy(sunDir);
      volumetric.uniforms.uClouds.value = u.uClouds.value;
      volumetric.uniforms.uCloudOffset.value.copy(u.uCloudOffset.value);
      // Cloud rays need broken cloud (clear skies have none, overcast is all shadow) and a sun up to cast them.
      volumetric.uniforms.uCloudRays.value = u.uCloudShadow.value > 0 && u.uClouds.value > 0.08 && sunDir.y > 0.02 ? 1 : 0;
      // Nothing to march while the volumetric slider is off (or at night, when main sets it to 0).
      volumetric.enabled = beamsAllowed && u.uVolumetric.value > 0;
      ao.uniforms.uFrame.value = noise;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uSunDir.value.copy(sunDir);
      u.uSunColor.value.copy(sunColor);
      sunWorld.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      u.uSunUv.value.set(sunWorld.x * 0.5 + 0.5, sunWorld.y * 0.5 + 0.5);
      camera.getWorldDirection(camDir);
      // Fade shafts out as the sun leaves the view instead of popping.
      u.uSunFacing.value = THREE.MathUtils.smoothstep(camDir.dot(sunDir), 0.0, 0.5);
      if (vibe.enabled) {
        vibe.uniforms.tDepth.value = waterPass ? waterPass.depth : target.depthTexture!;
        vibe.uniforms.uNear.value = camera.near;
        vibe.uniforms.uFar.value = camera.far;
        vibe.uniforms.uTime.value = performance.now() / 1000;
      }
      composer.render();
      taa.endFrame();
    },
  };
}
