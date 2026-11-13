import * as THREE from 'three';
import { quality } from './quality';

/**
 * Two-cascade sun shadows: a tight, sharp map around the viewer, redrawn every frame, and a wide far map that
 * carries shadows out toward the horizon, redrawn only every few frames (distant shadows barely change).
 *
 * The far light has zero intensity; it exists only for its shadow map. Replacements for three's shadow and light
 * chunks (installed once into ShaderChunk, so every lit material picks them up without per-material setup) light
 * with the near light and take its shadow from the near map inside its square, the far map outside, blended at
 * the seam. With the far cascade off there is one directional light and three's own code runs.
 *
 * Only the near shadow coordinate is passed from the vertex shader. The far one is worked out per fragment, and
 * only where it's needed: a second per-vertex coordinate cost ~3 ms on the vertex-heavy trees and cover.
 */
const CASCADED = '( NUM_DIR_LIGHTS == 2 ) && ( NUM_DIR_LIGHT_SHADOWS == 2 )';

const CASCADE_VARYING = /* glsl */ `
#if ${CASCADED}
  varying vec4 vDirectionalShadowCoord[ 1 ];
#else
  varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
#endif
`;

const CASCADE_VERTEX = /* glsl */ `
#if ${CASCADED}
    shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ 0 ].shadowNormalBias, 0 );
    vDirectionalShadowCoord[ 0 ] = directionalShadowMatrix[ 0 ] * shadowWorldPosition;
#elif NUM_DIR_LIGHT_SHADOWS > 0
`;

const CASCADE_LOOP = /* glsl */ `
#if ${CASCADED} && defined( RE_Direct ) && defined( USE_SHADOWMAP )
  {
    DirectionalLight directionalLight = directionalLights[ 0 ];
    getDirectionalLightInfo( directionalLight, directLight );
    if ( directLight.visible && receiveShadow ) {
      vec3 nc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
      vec2 e = abs( nc.xy - 0.5 ) * 2.0;
      // Fade from the near map to the far one over the outer part of the near square.
      float nearW = ( nc.z > 1.0 ) ? 0.0 : 1.0 - smoothstep( 0.78, 0.95, max( e.x, e.y ) );
      float s = 1.0;
      if ( nearW > 0.0 ) {
        DirectionalLightShadow sh = directionalLightShadows[ 0 ];
        s = getShadow( directionalShadowMap[ 0 ], sh.shadowMapSize, sh.shadowIntensity, sh.shadowBias, sh.shadowRadius, vDirectionalShadowCoord[ 0 ] );
      }
      if ( nearW < 1.0 ) {
        DirectionalLightShadow sh = directionalLightShadows[ 1 ];
        // World position and normal from the view-space ones, offset along the normal like three's vertex code.
        vec3 wp = ( vec4( geometryPosition - viewMatrix[ 3 ].xyz, 0.0 ) * viewMatrix ).xyz;
        vec3 wn = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
        vec4 farCoord = directionalShadowMatrix[ 1 ] * vec4( wp + wn * sh.shadowNormalBias, 1.0 );
        #if defined( SHADOWMAP_TYPE_PCF ) && !defined( USE_REVERSED_DEPTH_BUFFER )
          // One hardware-filtered tap (2×2 PCF) instead of three's five: the far map is coarse anyway.
          vec3 fc = farCoord.xyz / farCoord.w;
          bool inFar = all( greaterThanEqual( fc, vec3( 0.0 ) ) ) && all( lessThanEqual( fc, vec3( 1.0 ) ) );
          float far = inFar ? mix( 1.0, texture( directionalShadowMap[ 1 ], vec3( fc.xy, fc.z + sh.shadowBias ) ), sh.shadowIntensity ) : 1.0;
        #else
          float far = getShadow( directionalShadowMap[ 1 ], sh.shadowMapSize, sh.shadowIntensity, sh.shadowBias, sh.shadowRadius, farCoord );
        #endif
        s = mix( far, s, nearW );
      }
      directLight.color *= s;
    }
    RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
#elif ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
`;

let installed = false;
function installCascadeChunk() {
  if (installed) return;
  const C = THREE.ShaderChunk as Record<string, string>;
  const varying = 'varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];';
  const matrix = 'uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];';
  const vertexLoop = /#if NUM_DIR_LIGHT_SHADOWS > 0(\s*#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_DIR_LIGHT_SHADOWS;[^]*?#pragma unroll_loop_end\s*)#endif/;
  const loop = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const ok =
    C.shadowmap_pars_vertex.includes(varying) &&
    C.shadowmap_pars_vertex.includes(matrix) &&
    C.shadowmap_pars_fragment.includes(varying) &&
    vertexLoop.test(C.shadowmap_vertex) &&
    C.lights_fragment_begin.includes(loop);
  if (!ok) {
    console.warn('Cascaded shadows: three.js shadow chunks changed; far shadows disabled.');
    return;
  }
  C.shadowmap_pars_vertex = C.shadowmap_pars_vertex.replace(varying, CASCADE_VARYING);
  // The fragment shader reads the far light's matrix itself: same name and type as the vertex declaration, so
  // it's the one program uniform three already sets.
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(
    varying,
    `${CASCADE_VARYING}
#if ${CASCADED}
  uniform mat4 directionalShadowMatrix[ 2 ];
#endif`,
  );
  C.shadowmap_vertex = C.shadowmap_vertex.replace(vertexLoop, (_m, body) => `${CASCADE_VERTEX}${body}#endif`);
  C.lights_fragment_begin = C.lights_fragment_begin.replace(loop, CASCADE_LOOP);
  installed = true;
}

const FAR_EVERY = 6;

/**
 * Layer for shadow casters that only the far map draws (mid-detail trees and impostors). The near map, redrawn
 * every frame, keeps to layer 0. Cameras that see the world must enable this layer (see `seeFarCasters`).
 */
export const FAR_CASTERS = 2;
/** An unused layer, set on the near shadow camera only so three uses its own layer mask, not the view camera's. */
const NEAR_ONLY = 3;

export function seeFarCasters(camera: THREE.Camera) {
  camera.layers.enable(FAR_CASTERS);
  camera.children.forEach((c) => c.layers.enable(FAR_CASTERS));
}

export class SunShadows {
  readonly far = new THREE.DirectionalLight('#ffffff', 0);
  private frame = 0;
  private lastDir = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();
  private v = new THREE.Vector3();

  constructor(readonly near: THREE.DirectionalLight, scene: THREE.Scene) {
    installCascadeChunk();
    this.far.castShadow = true;
    this.far.shadow.bias = -0.0008;
    this.far.shadow.normalBias = 1.2;
    this.far.shadow.autoUpdate = false;
    this.near.shadow.camera.layers.set(0);
    this.near.shadow.camera.layers.enable(NEAR_ONLY);
    this.far.shadow.camera.layers.set(0);
    this.far.shadow.camera.layers.enable(FAR_CASTERS);
    // Added after the near light: three keeps shadow-casting lights in scene order, so near is index 0.
    scene.add(this.far, this.far.target);
    this.applyQuality();
  }

  /** Sizes both maps from the quality preset; the far cascade is off on Low. */
  applyQuality() {
    this.fit(this.near, quality.shadowMapSize, quality.shadowExtent);
    const useFar = quality.farShadowExtent > 0 && installed;
    this.far.visible = useFar;
    if (useFar) this.fit(this.far, quality.farShadowMapSize, quality.farShadowExtent);
    this.frame = 0;
  }

  private fit(light: THREE.DirectionalLight, size: number, extent: number) {
    if (light.shadow.mapSize.x !== size) {
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
    Object.assign(light.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 1200 + extent * 3 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }

  /** Centers a light's shadow square on `center`, snapped to whole shadow texels so edges don't crawl. */
  private place(light: THREE.DirectionalLight, center: THREE.Vector3, dir: THREE.Vector3, distance: number) {
    const extent = light.shadow.camera.right;
    const texel = (2 * extent) / light.shadow.mapSize.x;
    this.basis.lookAt(this.v.set(0, 0, 0), dir, THREE.Object3D.DEFAULT_UP);
    this.inverse.copy(this.basis).invert();
    const p = this.v.copy(center).applyMatrix4(this.inverse);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.basis);
    light.target.position.copy(p);
    light.position.copy(p).addScaledVector(dir, distance);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }

  /** Call every frame before rendering, with the sun's (or moon's) direction. */
  update(center: THREE.Vector3, dir: THREE.Vector3) {
    this.place(this.near, center, dir, 500);
    if (!this.far.visible) return;
    // As the sun moves (day speed), redraw once it has turned about a degree.
    const turned = this.lastDir.dot(dir) < 0.9998;
    if (this.frame % FAR_EVERY === 0 || turned) {
      // Moved only when redrawn, so the map always matches where the light is.
      this.place(this.far, center, dir, 1000 + this.far.shadow.camera.right);
      this.far.shadow.needsUpdate = true;
      this.lastDir.copy(dir);
    }
    this.frame++;
  }

  /** Redraw the far map on the next frame (after a teleport or regenerate). */
  refresh() {
    this.frame = 0;
  }
}
