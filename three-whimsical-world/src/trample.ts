import * as THREE from 'three';

/**
 * What feet do to the ground. Two maps around the player, redrawn each frame from short histories:
 *
 * - Prints (2048² over 48 m, ~2.3 cm a texel): a boot print each stride the player takes and hoof prints from
 *   walking deer, each a dent with a little rim of pushed-up snow or sand. The terrain shades and dents them
 *   where there's snow or sand (wet sand most of all), and they fill in over a couple of minutes, sooner while it
 *   snows.
 * - Trample (256² over 64 m): soft discs along the paths of the player and the deer. Green is how flattened the
 *   grass is there, blue/alpha which way it's pushed (away from the path). Blades bend aside where you walk and
 *   spring back up over twenty seconds or so.
 *
 * Both are centered on the player, snapped to whole texels so they don't swim as you walk.
 */

const PRINT_SIZE = 48;
export const PRINT_RES = 2048;
const TRAMPLE_SIZE = 64;
const TRAMPLE_RES = 256;
const MAX_PRINTS = 384;
const MAX_DISCS = 384;
/** Seconds a print lasts in fine weather (snowfall fills them in sooner). */
const PRINT_LIFE = 150;
/** Seconds for flattened grass to stand back up. */
const SPRING_BACK = 9;

export const trampleUniforms = {
  tPrints: { value: null as THREE.Texture | null },
  /** (min x, min z, size, 1 when there are any prints). */
  uPrintRect: { value: new THREE.Vector4(0, 0, PRINT_SIZE, 0) },
  tTrample: { value: null as THREE.Texture | null },
  uTrampleRect: { value: new THREE.Vector4(0, 0, TRAMPLE_SIZE, 0) },
};

const fullRect = /* glsl */ `
  uniform vec4 uRect;
  vec4 toMap(vec2 world) {
    return vec4((world - uRect.xy) / uRect.z * 2.0 - 1.0, 0.0, 1.0);
  }
`;

/** Prints: per instance (x, z, yaw, strength) and kind (0 left boot, 1 right boot, 2 hoof pair). */
function printMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uRect: { value: new THREE.Vector4() } },
    vertexShader: /* glsl */ `
      attribute vec4 aPrint;
      attribute float aKind;
      varying vec2 vLocal;
      varying float vStrength;
      varying float vKind;
      ${fullRect}
      void main() {
        // A quad 44 cm long and 22 cm wide round the print (hooves: 16 cm square), turned to its heading.
        vec2 ext = aKind > 1.5 ? vec2(0.08, 0.08) : vec2(0.11, 0.22);
        vec2 q = position.xy * 2.0 * ext;
        float c = cos(aPrint.z), s = sin(aPrint.z);
        // Local y runs toe-ward, along the heading (x, z) = (sin yaw, cos yaw).
        vec2 world = aPrint.xy + vec2(q.x * c + q.y * s, -q.x * s + q.y * c);
        vLocal = q;
        vStrength = aPrint.w;
        vKind = aKind;
        gl_Position = toMap(world);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying float vStrength;
      varying float vKind;
      // A soft dent of a given radius (ellipse radii r), with a rim of displaced ground just outside it.
      float dent(vec2 p, vec2 r) {
        float d = length(p / r);
        return smoothstep(1.0, 0.7, d) - 0.3 * smoothstep(0.9, 1.15, d) * smoothstep(1.5, 1.15, d);
      }
      void main() {
        vec2 p = vLocal;
        float h;
        if (vKind > 1.5) {
          // A cloven hoof: two narrow halves side by side, pointed toward the toe.
          vec2 r = vec2(0.016, 0.03 - 0.008 * clamp(p.y * 30.0, -1.0, 1.0));
          h = max(dent(p - vec2(-0.02, 0.0), r), dent(p - vec2(0.02, 0.0), r));
        } else {
          // A boot: a broad sole and a heel, the sole turned a touch outward; lugs ribbing the bottom.
          float side = vKind > 0.5 ? 1.0 : -1.0;
          vec2 sole = p - vec2(0.008 * side, 0.05);
          sole = vec2(sole.x + sole.y * 0.1 * side, sole.y);
          h = max(dent(sole, vec2(0.058, 0.1)), dent(p - vec2(0.0, -0.1), vec2(0.048, 0.06)));
          // The instep: a shallower waist joining sole and heel, so it reads as one boot.
          h = max(h, 0.6 * dent(p - vec2(0.004 * side, -0.035), vec2(0.036, 0.06)));
          float lugs = 0.88 + 0.12 * step(0.5, fract(p.y * 40.0));
          h *= h > 0.0 ? lugs : 1.0;
        }
        gl_FragColor = vec4(h * vStrength, 0.0, 0.0, 1.0);
      }
    `,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
}

/** Trample discs: per instance (x, z, radius, strength). */
function discMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uRect: { value: new THREE.Vector4() } },
    vertexShader: /* glsl */ `
      attribute vec4 aDisc;
      varying vec2 vLocal;
      varying float vStrength;
      ${fullRect}
      void main() {
        vLocal = position.xy * 2.0;
        vStrength = aDisc.w;
        gl_Position = toMap(aDisc.xy + position.xy * 2.0 * aDisc.z);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying float vStrength;
      void main() {
        float d = length(vLocal);
        float w = smoothstep(1.0, 0.35, d) * vStrength;
        gl_FragColor = vec4(0.0, w, vLocal / max(d, 1e-3) * w * smoothstep(0.0, 0.3, d));
      }
    `,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
}

interface Print { x: number; z: number; yaw: number; kind: number; age: number }
interface Disc { x: number; z: number; r: number; age: number }

/** Something walking: where it is, its heading as a yaw (x, z) = (sin, cos), and how big it is. */
export interface Walker { id: object; x: number; z: number; yaw: number; speed: number; size: number }

export class Trample {
  private prints: Print[] = [];
  private discs: Disc[] = [];
  private printTarget = new THREE.WebGLRenderTarget(PRINT_RES, PRINT_RES, {
    type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  private trampleTarget = new THREE.WebGLRenderTarget(TRAMPLE_RES, TRAMPLE_RES, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  private printMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private discMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private printAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS * 4), 4);
  private kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS), 1);
  private discAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DISCS * 4), 4);
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  /** Where each walker last left a mark, and which foot is next. */
  private last = new WeakMap<object, { x: number; z: number; disc: number; step: number; foot: number }>();
  private clear = new THREE.Color();

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const printGeo = new THREE.InstancedBufferGeometry().copy(quad as unknown as THREE.InstancedBufferGeometry);
    printGeo.setAttribute('aPrint', this.printAttr);
    printGeo.setAttribute('aKind', this.kindAttr);
    this.printMesh = new THREE.Mesh(printGeo, printMaterial());
    const discGeo = new THREE.InstancedBufferGeometry().copy(quad as unknown as THREE.InstancedBufferGeometry);
    discGeo.setAttribute('aDisc', this.discAttr);
    this.discMesh = new THREE.Mesh(discGeo, discMaterial());
    for (const m of [this.printMesh, this.discMesh]) {
      m.frustumCulled = false;
      this.scene.add(m);
    }
    this.printAttr.setUsage(THREE.DynamicDrawUsage);
    this.kindAttr.setUsage(THREE.DynamicDrawUsage);
    this.discAttr.setUsage(THREE.DynamicDrawUsage);
    trampleUniforms.tPrints.value = this.printTarget.texture;
    trampleUniforms.tTrample.value = this.trampleTarget.texture;
  }

  /** A boot print for a step at (x, z) heading `yaw` (`foot` 0 left, 1 right). */
  footfall(x: number, z: number, yaw: number, foot: number) {
    // The feet sit a hand's width either side of the line of travel.
    const side = foot ? 1 : -1;
    const rx = -Math.cos(yaw) * 0.11 * side, rz = Math.sin(yaw) * 0.11 * side;
    this.addPrint({ x: x + rx, z: z + rz, yaw: yaw + side * 0.08, kind: foot, age: 0 });
  }

  private addPrint(p: Print) {
    this.prints.push(p);
    if (this.prints.length > MAX_PRINTS) this.prints.shift();
  }

  /**
   * Ages the marks and lays new ones: trample discs along each walker's path (and under it as it stands), hoof
   * prints for deer as they walk. `fill` (0..1, the snowfall) fills prints in faster.
   */
  update(dt: number, walkers: Walker[], fill: number) {
    for (const p of this.prints) p.age += dt * (1 + 6 * fill);
    this.prints = this.prints.filter((p) => p.age < PRINT_LIFE);
    for (const d of this.discs) d.age += dt;
    this.discs = this.discs.filter((d) => d.age < SPRING_BACK * 3);
    for (const w of walkers) {
      let l = this.last.get(w.id);
      if (!l) {
        l = { x: w.x, z: w.z, disc: 0, step: 0, foot: 0 };
        this.last.set(w.id, l);
      }
      const moved = Math.hypot(w.x - l.x, w.z - l.z);
      l.x = w.x;
      l.z = w.z;
      if (moved > 2) continue; // a teleport, not a stride
      l.disc += moved;
      if (l.disc > 0.3 * w.size) {
        l.disc = 0;
        this.discs.push({ x: w.x, z: w.z, r: 0.55 * w.size, age: 0 });
        if (this.discs.length > MAX_DISCS) this.discs.shift();
      }
      // A print each step, alternating feet; strides lengthen with speed. Deer leave hoof prints (the hind hoof
      // lands in the fore's), people boot prints.
      const speed = dt > 0 ? moved / dt : 0;
      l.step += moved;
      const stride = w.size > 1 ? 0.55 * w.size : THREE.MathUtils.clamp(0.5 + speed * 0.17, 0.6, 1.3);
      if (l.step > stride && speed > 0.2 && (w.size <= 1 || speed < 4)) {
        l.step = 0;
        l.foot ^= 1;
        if (w.size > 1) {
          const side = l.foot ? 1 : -1, s = 0.1 * w.size;
          this.addPrint({ x: w.x - Math.cos(w.yaw) * s * side, z: w.z + Math.sin(w.yaw) * s * side, yaw: w.yaw, kind: 2, age: 0 });
        } else this.footfall(w.x, w.z, w.yaw, l.foot);
      }
    }
    this.walkers = walkers;
  }

  private walkers: Walker[] = [];

  /** Redraws both maps around `center`. */
  render(renderer: THREE.WebGLRenderer, center: THREE.Vector3) {
    const snap = (v: number, size: number, res: number) => Math.floor(v / (size / res)) * (size / res) - size / 2;
    const pr = trampleUniforms.uPrintRect.value.set(snap(center.x, PRINT_SIZE, PRINT_RES), snap(center.z, PRINT_SIZE, PRINT_RES), PRINT_SIZE, 0);
    const tr = trampleUniforms.uTrampleRect.value.set(snap(center.x, TRAMPLE_SIZE, TRAMPLE_RES), snap(center.z, TRAMPLE_SIZE, TRAMPLE_RES), TRAMPLE_SIZE, 1);

    // Prints: deepest when fresh, filling in over the last half of their life.
    let n = 0;
    const pa = this.printAttr.array as Float32Array, ka = this.kindAttr.array as Float32Array;
    for (const p of this.prints) {
      if (Math.abs(p.x - center.x) > PRINT_SIZE / 2 + 1 || Math.abs(p.z - center.z) > PRINT_SIZE / 2 + 1) continue;
      pa.set([p.x, p.z, p.yaw, 1 - THREE.MathUtils.smoothstep(p.age, PRINT_LIFE * 0.4, PRINT_LIFE)], n * 4);
      ka[n] = p.kind;
      n++;
    }
    this.printMesh.geometry.instanceCount = n;
    this.printAttr.needsUpdate = this.kindAttr.needsUpdate = true;
    pr.w = n > 0 ? 1 : 0;

    // Trample: the path behind, springing back up, plus whoever is standing on the grass right now.
    let m = 0;
    const da = this.discAttr.array as Float32Array;
    const addDisc = (x: number, z: number, r: number, s: number) => {
      if (m >= MAX_DISCS) return;
      da.set([x, z, r, s], m * 4);
      m++;
    };
    for (const d of this.discs) addDisc(d.x, d.z, d.r, Math.exp(-d.age / SPRING_BACK) * 0.8);
    for (const w of this.walkers) addDisc(w.x, w.z, 0.6 * w.size, 1);
    this.discMesh.geometry.instanceCount = m;
    this.discAttr.needsUpdate = true;

    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    this.printMesh.material.uniforms.uRect.value.copy(pr);
    this.printMesh.visible = true;
    this.discMesh.visible = false;
    renderer.setRenderTarget(this.printTarget);
    renderer.clear(true, false, false);
    if (n > 0) renderer.render(this.scene, this.camera);

    this.discMesh.material.uniforms.uRect.value.copy(tr);
    this.printMesh.visible = false;
    this.discMesh.visible = true;
    renderer.setRenderTarget(this.trampleTarget);
    renderer.clear(true, false, false);
    if (m > 0) renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.printTarget.dispose();
    this.trampleTarget.dispose();
    this.printMesh.geometry.dispose();
    this.discMesh.geometry.dispose();
    this.printMesh.material.dispose();
    this.discMesh.material.dispose();
  }
}
