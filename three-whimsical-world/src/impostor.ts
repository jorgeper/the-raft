import * as THREE from 'three';
import { seasonUniforms } from './season';
import { weatherUniforms } from './weather';

const TEXTURE_HEIGHT = 512;

export interface Impostor {
  texture: THREE.Texture;
  /** White where the bake shows leaves, black on bark: what turns and falls with the seasons. */
  leafMask: THREE.Texture;
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
  const barkMesh = new THREE.Mesh(branches, new THREE.MeshBasicMaterial({ map: bark.map, color: bark.color }));
  const leafMesh = new THREE.Mesh(
    leaves,
    new THREE.MeshBasicMaterial({ map: leaf.map, color: leaf.color, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  scene.add(barkMesh, leafMesh);
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
  // The leaf mask: the same view with the bark black and the leaves white (cut out by their texture's alpha). A
  // color test on the bake can't tell them apart once species tints warm the leaves toward the bark's browns.
  const maskTarget = new THREE.WebGLRenderTarget(width, TEXTURE_HEIGHT, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const white = new THREE.MeshBasicMaterial({ map: leaf.map, alphaTest: 0.5, side: THREE.DoubleSide });
  white.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.a *= texture2D(map, vMapUv).a;');
  };
  const barkMat = barkMesh.material, leafMat = leafMesh.material;
  barkMesh.material = black;
  leafMesh.material = white;
  renderer.setRenderTarget(maskTarget);
  renderer.clear();
  renderer.render(scene, camera);
  barkMesh.material = barkMat;
  leafMesh.material = leafMat;
  for (const m of [black, white, barkMat, leafMat]) m.dispose();
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  const geometry = new THREE.PlaneGeometry(2 * halfWidth, top - bottom);
  geometry.translate(0, (top + bottom) / 2, 0);
  return { texture: target.texture, leafMask: maskTarget.texture, geometry };
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
  uniform float uWither;
  vec3 autumnLeaves(vec3 c, vec3 inst, float mask) {
    float lum = dot(c / max(inst, vec3(1e-3)), vec3(0.3, 0.59, 0.11));
    // Blossom (spring): very little green in the instance color.
    float blossom = (1.0 - smoothstep(0.35, 0.45, inst.g / max(inst.r, 1e-3))) * mask;
    if (blossom > 0.0) return mix(c, vec3(2.3, 1.85, 1.95) * lum * inst.r, blossom * 0.88);
    float autumn = (1.0 - smoothstep(0.4, 0.6, inst.b / max(inst.r, 1e-3))) * mask;
    if (autumn <= 0.0) return c;
    float hue = smoothstep(0.55, 1.0, inst.g / max(inst.r, 1e-3));
    // Bright and saturated: fiery red-orange to gold.
    vec3 turned = mix(vec3(3.2, 0.62, 0.14), vec3(3.3, 2.2, 0.22), hue) * lum * inst.r;
    // Winter: what's left on the tree has withered brown.
    turned = mix(turned, vec3(1.15, 0.72, 0.4) * lum * inst.r, uWither);
    return mix(c, turned, autumn);
  }
`;

/**
 * Leaves falling (GLSL, for broadleaf species: \`BARE_K\` defined to how bare they get): leaves drop in clumps by a
 * hash of where they sit on the tree (\`vLeafCell\`, from the vertex shader) as \`uBare\` rises.
 */
export const BARE_VERTEX = /* glsl */ `
  #ifdef BARE_K
    vLeafCell = position * 2.2;
    #ifdef USE_INSTANCING
      vLeafCell += fract(instanceMatrix[3].xyz * 0.0173) * 61.0;
    #endif
  #endif
`;
export const BARE_FRAGMENT = /* glsl */ `
  #ifdef BARE_K
    if (fract(sin(dot(floor(vLeafCell), vec3(12.9898, 78.233, 37.719))) * 43758.5453) < uBare * BARE_K) discard;
  #endif
`;
export const BARE_DECLS = /* glsl */ `
  #ifdef BARE_K
    varying vec3 vLeafCell;
    uniform float uBare;
  #endif
`;

/** Instanced, cylindrically billboarded quads using a baked impostor texture. */
export function createImpostorMesh(impostor: Impostor, capacity: number, bareK = 0) {
  const material = new THREE.MeshStandardMaterial({
    map: impostor.texture,
    // The bake includes crown AO and lacks the leaves' backlit glow; lift it to match nearby trees.
    color: new THREE.Color(1.3, 1.35, 1.2),
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  if (bareK > 0) material.defines = { BARE_K: bareK.toFixed(2) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = weatherUniforms.uSnow;
    shader.uniforms.tLeafMask = { value: impostor.leafMask };
    Object.assign(shader.uniforms, seasonUniforms);
    // Autumn trees turn only their leaves (the bake's leaf mask), not the trunk.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AUTUMN_LEAVES}\nuniform float uSnow;\nuniform float uBare;\nuniform sampler2D tLeafMask;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float leafy = smoothstep(0.3, 0.7, texture2D(tLeafMask, vMapUv).r);
        #ifdef BARE_K
          // Fallen leaves: far crowns thin out in clumps of the bake, down to the branches.
          if (leafy > 0.5 && fract(sin(dot(floor(vMapUv * 34.0), vec2(12.9898, 78.233))) * 43758.5453) < uBare * BARE_K) discard;
        #endif
        // (Fragment shaders see the instance color only as USE_COLOR: three defines USE_INSTANCING_COLOR in the vertex
        // shader alone, so an #ifdef on it here never ran and the autumn drifts never showed.)
        #ifdef USE_COLOR
          diffuseColor.rgb = autumnLeaves(diffuseColor.rgb, vColor.rgb, leafy);
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
