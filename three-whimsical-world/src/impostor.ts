import * as THREE from 'three';
import { weatherUniforms } from './weather';

const TEXTURE_HEIGHT = 512;

export interface Impostor {
  texture: THREE.Texture;
  geometry: THREE.BufferGeometry;
}

/** True once a material's color texture has finished loading (ez-tree loads its textures asynchronously). */
export function textureReady(material: THREE.MeshStandardMaterial) {
  const image = material.map?.image as HTMLImageElement | undefined;
  return !!image && image.complete && image.naturalWidth > 0;
}

/**
 * Renders a tree once, unlit, from the side into a transparent texture. Far away the tree is drawn as a
 * single camera-facing quad with that texture: 2 triangles instead of thousands.
 */
export function bakeImpostor(
  renderer: THREE.WebGLRenderer,
  branches: THREE.BufferGeometry,
  leaves: THREE.BufferGeometry,
  bark: THREE.MeshStandardMaterial,
  leaf: THREE.MeshStandardMaterial,
): Impostor {
  const box = new THREE.Box3();
  branches.computeBoundingBox();
  leaves.computeBoundingBox();
  box.copy(branches.boundingBox!).union(leaves.boundingBox!);
  // Center horizontally on the trunk (x = 0) so the quad rotates around it.
  const halfWidth = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
  const bottom = box.min.y, top = box.max.y;

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(branches, new THREE.MeshBasicMaterial({ map: bark.map, color: bark.color })));
  scene.add(
    new THREE.Mesh(
      leaves,
      new THREE.MeshBasicMaterial({ map: leaf.map, color: leaf.color, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    ),
  );
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, top, bottom, 0.1, 1000);
  camera.position.set(0, 0, 500);
  camera.lookAt(0, 0, 0);
  // Ortho camera's vertical frame is relative to its position, so keep y = 0 and use top/bottom directly.

  const width = Math.max(64, Math.round((TEXTURE_HEIGHT * 2 * halfWidth) / (top - bottom)));
  const target = new THREE.WebGLRenderTarget(width, TEXTURE_HEIGHT, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    samples: 4,
  });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  const geometry = new THREE.PlaneGeometry(2 * halfWidth, top - bottom);
  geometry.translate(0, (top + bottom) / 2, 0);
  return { texture: target.texture, geometry };
}

/** Turns the quad about its trunk to face the camera (needs `bbRoot` and `toCam`). */
const BILLBOARD = /* glsl */ `
  float bbScale = length(instanceMatrix[0].xyz);
  vec3 bbRight = vec3(toCam.z, 0.0, -toCam.x);
  vec3 bbPos = bbRoot + (bbRight * transformed.x + vec3(0.0, transformed.y, 0.0)) * bbScale;
  vec4 mvPosition = viewMatrix * vec4(bbPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Autumn leaves (GLSL): an instance color with little blue marks an autumn tree (trees.ts), its green/red ratio
 * picks copper-red to gold. Takes the lit-free leaf color after the instance color was applied and returns it
 * turned by brightness.
 */
export const AUTUMN_LEAVES = /* glsl */ `
  vec3 autumnLeaves(vec3 c, vec3 inst, float mask) {
    float autumn = (1.0 - smoothstep(0.4, 0.6, inst.b / max(inst.r, 1e-3))) * mask;
    if (autumn <= 0.0) return c;
    float lum = dot(c / max(inst, vec3(1e-3)), vec3(0.3, 0.59, 0.11));
    float hue = smoothstep(0.55, 1.0, inst.g / max(inst.r, 1e-3));
    vec3 turned = mix(vec3(2.6, 0.72, 0.2), vec3(2.8, 1.95, 0.26), hue) * lum * inst.r;
    return mix(c, turned, autumn * 0.9);
  }
`;

/** Instanced, cylindrically billboarded quads using a baked impostor texture. */
export function createImpostorMesh(impostor: Impostor, capacity: number) {
  const material = new THREE.MeshStandardMaterial({
    map: impostor.texture,
    // The bake includes crown AO and lacks the leaves' backlit glow; lift it to match nearby trees.
    color: new THREE.Color(1.3, 1.35, 1.2),
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = weatherUniforms.uSnow;
    // Autumn trees turn only their leaves: the green pixels of the bake, not the trunk.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AUTUMN_LEAVES}\nuniform float uSnow;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float leafy = smoothstep(0.0, 0.04, diffuseColor.g - diffuseColor.r * 0.95);
        #ifdef USE_INSTANCING_COLOR
          diffuseColor.rgb = autumnLeaves(diffuseColor.rgb, vColor, leafy);
        #endif
        // Snow: far crowns speckled white, more toward their tops, like the near trees' outer shell.
        if (uSnow > 0.0) {
          float fleck = fract(sin(dot(floor(vMapUv * 96.0), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.73, 0.78), uSnow * leafy * (0.25 + 0.35 * fleck) * (0.6 + 0.4 * vMapUv.y));
        }`,
      );
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <defaultnormal_vertex>',
        /* glsl */ `
        vec3 bbRoot = instanceMatrix[3].xyz;
        vec3 toCam = cameraPosition - bbRoot;
        toCam.y = 0.0;
        toCam = normalize(toCam);
        // Lit like a rounded canopy facing the viewer and the sky.
        vec3 transformedNormal = normalize(mat3(viewMatrix) * normalize(toCam + vec3(0.0, 0.8, 0.0)));
        `,
      )
      .replace('#include <project_vertex>', BILLBOARD);
  };
  const mesh = new THREE.InstancedMesh(impostor.geometry, material, Math.max(capacity, 1));
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  // For the far shadow cascade the quad turns to face the sun (the shadow camera), so it casts the crown's
  // silhouette. (The renderer copies the map and alpha test over from the material above.)
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec3 bbRoot = instanceMatrix[3].xyz;
      vec3 toCam = cameraPosition - bbRoot;
      toCam.y = 0.0;
      toCam = normalize(toCam);
      ${BILLBOARD}
      `,
    );
  };
  mesh.customDepthMaterial = depth;
  return mesh;
}
