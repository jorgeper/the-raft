import * as THREE from 'three';

/** Shared by every swaying material so grass and trees move with the same gusts. */
export const wind = {
  uTime: { value: 0 },
  uWindStrength: { value: 1 },
};

/** GLSL: world-space displacement for a point rooted at `root`; `flex` is 0 at the base and 1 at the tip. */
export const windGLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  vec3 windOffset(vec3 root, float flex) {
    vec2 dir = normalize(vec2(1.0, 0.35));
    // Broad gusts rolling across the landscape in the wind direction.
    float along = dot(root.xz, dir);
    float gust = 0.5 + 0.5 * sin(along * 0.045 - uTime * 1.3) * sin(root.x * 0.013 + root.z * 0.021 + uTime * 0.4);
    // Local, faster flutter so neighbors don't move in lockstep.
    float flutter = sin(uTime * 2.3 + root.x * 0.7 + root.z * 0.43) * 0.3 + sin(uTime * 4.1 + root.z * 1.3) * 0.12;
    float amount = uWindStrength * flex * (0.15 + 0.85 * gust) * (0.75 + flutter);
    // Bent blades also dip slightly, so the tip follows an arc instead of stretching.
    return vec3(dir.x * amount, -0.35 * amount * amount, dir.y * amount);
  }
`;

/**
 * Patches a standard material so instanced vertices sway in the wind.
 * `body` is GLSL run after instancing; it gets `root` (instance origin) and `p` (world position, editable).
 */
export function addWind(material: THREE.Material, body: string, extraUniforms: Record<string, THREE.IUniform> = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind, extraUniforms);
    const decls = Object.keys(extraUniforms)
      .map((name) => `uniform ${glslType(extraUniforms[name].value)} ${name};`)
      .join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${windGLSL}\n${decls}`)
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
        ${body}
        mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        `,
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
