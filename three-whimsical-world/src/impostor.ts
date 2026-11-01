import * as THREE from 'three';

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
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        float bbScale = length(instanceMatrix[0].xyz);
        vec3 bbRight = vec3(toCam.z, 0.0, -toCam.x);
        vec3 bbPos = bbRoot + (bbRight * transformed.x + vec3(0.0, transformed.y, 0.0)) * bbScale;
        vec4 mvPosition = viewMatrix * vec4(bbPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
  };
  const mesh = new THREE.InstancedMesh(impostor.geometry, material, Math.max(capacity, 1));
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}
