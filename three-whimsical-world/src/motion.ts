import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import type { TAAPass } from './taa';

/**
 * Motion vectors for things that move on their own: the character, deer, frogs, fish, birds, butterflies.
 * The TAA reprojects everything else from the depth buffer and the camera's motion, which put these objects' history
 * where the world behind them was: the character, who moves with the camera, smeared into the grass whenever you ran.
 *
 * After the scene renders, this pass draws just those objects again into a small buffer: per pixel, how far that
 * surface moved on screen since last frame (from last frame's object matrix, instance matrices and bone poses) and
 * its view depth. The TAA uses the motion where that depth matches the scene's (so grass in front still moves
 * with the camera). Shader-only animation (tails, rocking pads) isn't captured; it is small.
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform mat4 uPrevModel;
  uniform mat4 uViewProjNow;
  uniform mat4 uViewProjPrev;
  #ifdef USE_SKINNING
    uniform highp sampler2D uPrevBones;
    mat4 prevBone(const in float i) {
      int size = textureSize(uPrevBones, 0).x;
      int j = int(i) * 4;
      int x = j % size, y = j / size;
      return mat4(texelFetch(uPrevBones, ivec2(x, y), 0), texelFetch(uPrevBones, ivec2(x + 1, y), 0),
        texelFetch(uPrevBones, ivec2(x + 2, y), 0), texelFetch(uPrevBones, ivec2(x + 3, y), 0));
    }
  #endif
  #ifdef USE_INSTANCING
    attribute mat4 aPrevInstance;
  #endif
  varying vec4 vNow;
  varying vec4 vPrev;
  varying float vDepth;
  void main() {
    vec4 p = vec4(position, 1.0), q = p;
    #ifdef USE_SKINNING
      vec4 s = bindMatrix * p;
      p = bindMatrixInverse * (getBoneMatrix(skinIndex.x) * s * skinWeight.x + getBoneMatrix(skinIndex.y) * s * skinWeight.y
        + getBoneMatrix(skinIndex.z) * s * skinWeight.z + getBoneMatrix(skinIndex.w) * s * skinWeight.w);
      q = bindMatrixInverse * (prevBone(skinIndex.x) * s * skinWeight.x + prevBone(skinIndex.y) * s * skinWeight.y
        + prevBone(skinIndex.z) * s * skinWeight.z + prevBone(skinIndex.w) * s * skinWeight.w);
    #endif
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      q = aPrevInstance * q;
    #endif
    vec4 world = modelMatrix * p;
    vec4 view = viewMatrix * world;
    gl_Position = projectionMatrix * view;
    vDepth = -view.z;
    vNow = uViewProjNow * world;
    vPrev = uViewProjPrev * (uPrevModel * q);
  }
`;
const fragmentShader = /* glsl */ `
  varying vec4 vNow;
  varying vec4 vPrev;
  varying float vDepth;
  void main() {
    vec2 now = vNow.xy / vNow.w * 0.5 + 0.5;
    vec2 prev = vPrev.w > 0.0 ? vPrev.xy / vPrev.w * 0.5 + 0.5 : now;
    // rg = where this surface was last frame, relative to now (uv units); b = view depth; a = 1 marks an object.
    gl_FragColor = vec4(prev - now, vDepth, 1.0);
  }
`;

interface MeshState {
  material: THREE.ShaderMaterial;
  prevModel: THREE.Matrix4;
  prevInstance?: THREE.InstancedBufferAttribute;
}

export class MotionPass extends Pass {
  /** rg: screen motion back to last frame (uv), b: view depth, a: 1 where a moving object is. */
  readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private meshes = new WeakMap<THREE.Mesh, MeshState>();
  private prevBones = new WeakMap<THREE.Skeleton, THREE.DataTexture>();
  private swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  private hidden: THREE.Object3D[] = [];
  private seen: THREE.Mesh[] = [];
  private clearColor = new THREE.Color();

  /** `roots` lists the groups whose meshes move on their own (asked every frame, so respawns and regenerates are fine). */
  constructor(private camera: THREE.PerspectiveCamera, private taa: TAAPass, private roots: () => (THREE.Object3D | null | undefined)[]) {
    super();
    this.needsSwap = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  private state(mesh: THREE.Mesh): MeshState {
    let s = this.meshes.get(mesh);
    if (!s) {
      s = {
        material: new THREE.ShaderMaterial({
          uniforms: {
            uPrevModel: { value: mesh.matrixWorld.clone() },
            uViewProjNow: { value: this.taa.viewProjNow },
            uViewProjPrev: { value: this.taa.prevViewProj },
            uPrevBones: { value: null },
          },
          vertexShader,
          fragmentShader,
          side: THREE.DoubleSide,
        }),
        prevModel: mesh.matrixWorld.clone(),
      };
      s.material.uniforms.uPrevModel.value = s.prevModel;
      this.meshes.set(mesh, s);
    }
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh && s.prevInstance?.array.length !== inst.instanceMatrix.array.length) {
      s.prevInstance = new THREE.InstancedBufferAttribute(new Float32Array(inst.instanceMatrix.array), 16);
      inst.geometry.setAttribute('aPrevInstance', s.prevInstance);
    }
    return s;
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.taa.enabled) return;
    const seen = this.seen;
    seen.length = 0;
    // Swap every visible mesh under the roots to its motion material; hide anything else that would draw.
    for (const root of this.roots()) {
      if (!root || !root.visible) continue;
      root.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const s = this.state(mesh);
          const skinned = mesh as THREE.SkinnedMesh;
          if (skinned.isSkinnedMesh) {
            const bones = this.prevBones.get(skinned.skeleton);
            // No previous pose yet (first frame drawn): no motion from the skeleton this time.
            s.material.uniforms.uPrevBones.value = bones ?? skinned.skeleton.boneTexture;
          }
          this.swapped.push({ mesh, material: mesh.material });
          mesh.material = s.material;
          seen.push(mesh);
        } else if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
          o.visible = false;
          this.hidden.push(o);
        }
      });
    }

    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    for (const root of this.roots()) if (root && root.visible && seen.length) renderer.render(root, this.camera);
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor, alpha);
    renderer.shadowMap.autoUpdate = shadows;

    for (const { mesh, material } of this.swapped) mesh.material = material;
    for (const o of this.hidden) o.visible = true;
    this.swapped.length = 0;
    this.hidden.length = 0;

    // Remember this frame's placement for the next.
    for (const mesh of seen) {
      const s = this.meshes.get(mesh)!;
      s.prevModel.copy(mesh.matrixWorld);
      const inst = mesh as THREE.InstancedMesh;
      if (inst.isInstancedMesh && s.prevInstance) {
        (s.prevInstance.array as Float32Array).set(inst.instanceMatrix.array);
        s.prevInstance.needsUpdate = true;
      }
      const skinned = mesh as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton.boneTexture && skinned.skeleton.boneMatrices) {
        const sk = skinned.skeleton;
        let tex = this.prevBones.get(sk);
        if (!tex) {
          const src = sk.boneTexture!;
          tex = new THREE.DataTexture(new Float32Array(sk.boneMatrices!.length), src.image.width, src.image.height, THREE.RGBAFormat, THREE.FloatType);
          this.prevBones.set(sk, tex);
        }
        if (tex.userData.frame !== renderer.info.render.frame) {
          (tex.image.data as Float32Array).set(sk.boneMatrices!);
          tex.needsUpdate = true;
          tex.userData.frame = renderer.info.render.frame;
        }
      }
    }
  }

  dispose() {
    this.target.dispose();
  }
}
