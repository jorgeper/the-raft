import * as THREE from 'three';
import { makeRng } from '../utils/rng.js';

// Sky dome, sun + hemisphere lights, puffy clouds, distant sunlit ridges.
// Everything here lives OUTSIDE the world group (camera stays near origin).

export function createSky(scene) {
  // --- gradient sky dome ---
  const skyUniforms = {
    uTop: { value: new THREE.Color(0.36, 0.66, 0.93) },
    uBottom: { value: new THREE.Color(0.82, 0.92, 0.99) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, -0.4).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6 + 0.25, 0.0, 1.0);
        vec3 col = mix(uBottom, uTop, pow(h, 0.8));
        float sunAmt = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 220.0);
        float halo = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 6.0);
        col += uSunColor * (sunAmt * 1.6 + halo * 0.22);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 16), skyMat);
  dome.frustumCulled = false;
  scene.add(dome);

  // --- lights ---
  const sun = new THREE.DirectionalLight(0xfff4dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x9ecbf5, 0x73a057, 0.9);
  scene.add(hemi);

  // --- puffy cumulus clouds (merged blobs, drifting slowly) ---
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdfe8f2, emissiveIntensity: 0.55, fog: false });
  const clouds = new THREE.Group();
  const rng = makeRng(777);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = rng.int(3, 6);
    for (let p = 0; p < puffs; p++) {
      const r = rng.range(9, 22);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), cloudMat);
      puff.position.set(rng.range(-24, 24), rng.range(0, 7) - r * 0.35, rng.range(-9, 9));
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    const ang = rng.range(-1.4, 1.4);
    const dist = rng.range(240, 430);
    cloud.position.set(Math.sin(ang) * dist, rng.range(90, 190), -Math.cos(ang) * dist);
    cloud.userData.driftSpeed = rng.range(0.4, 1.1);
    clouds.add(cloud);
  }
  scene.add(clouds);

  // --- distant sunlit ridge silhouettes ---
  const ridges = new THREE.Group();
  const ridgeColors = [0x8fb87a, 0x7aa5c9, 0x9db4d6];
  for (let layer = 0; layer < 3; layer++) {
    const pts = [];
    const seg = 48;
    const r2 = makeRng(31 + layer * 7);
    const width = 1400;
    let peaks = [];
    for (let i = 0; i <= seg; i++) {
      const x = (i / seg - 0.5) * width;
      const h = 26 + layer * 34 + r2.range(0, 40) + Math.sin(i * 1.3 + layer * 5) * (14 + layer * 12);
      peaks.push([x, h]);
    }
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -80);
    for (const [x, h] of peaks) shape.lineTo(x, h);
    shape.lineTo(width / 2, -80);
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color: ridgeColors[layer], fog: false, transparent: true, opacity: 0.85 - layer * 0.18 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -20 - layer * 6, -(340 + layer * 70));
    ridges.add(mesh);
  }
  scene.add(ridges);

  function applyPhase(p, elapsed) {
    skyUniforms.uTop.value.setRGB(...p.skyTop);
    skyUniforms.uBottom.value.setRGB(...p.skyBottom);
    sun.color.setRGB(...p.sun);
    sun.intensity = p.sunIntensity;
    const alt = p.sunAlt;
    const sunPos = new THREE.Vector3(28, 90 * alt + 18, -35).normalize().multiplyScalar(90);
    sun.position.copy(sunPos);
    sun.target.position.set(0, 0, -10);
    skyUniforms.uSunDir.value.copy(sunPos).normalize();
    hemi.color.setRGB(...p.hemiSky);
    hemi.groundColor.setRGB(...p.hemiGround);
    hemi.intensity = p.hemiIntensity;
    for (const c of clouds.children) {
      c.position.x += Math.sin(elapsed * 0.02) * 0.002 + c.userData.driftSpeed * 0.008;
      if (c.position.x > 500) c.position.x = -500;
    }
  }

  return { applyPhase, sun, hemi };
}
