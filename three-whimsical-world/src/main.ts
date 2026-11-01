import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import GUI from 'lil-gui';
import { createWater } from './water';
import { wind, sunLight } from './wind';
import { createPost } from './post';
import { World, MAX_WATER_DEPTH } from './world';
import { DEFAULT_PARAMS, type WorldParams } from './worldgen';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.65;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);

// --- Sky, environment lighting, and water reflections all come from one sky model.
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);

const skyScene = new THREE.Scene();
const skyBox = new THREE.Mesh(sky.geometry, sky.material);
skyBox.scale.setScalar(1000); // must sit beyond the cube camera near plane
skyScene.add(skyBox);
const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const cubeCamera = new THREE.CubeCamera(1, 20000, cubeTarget);
skyScene.add(cubeCamera);
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget: THREE.WebGLRenderTarget | null = null;

// One directional light plays the sun by day and the moon by night.
const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const shadowExtent = 160;
Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 1200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
// Faint blue fill so nights are dark but readable.
const nightFill = new THREE.HemisphereLight('#3a4f7a', '#0d120c', 0);
scene.add(nightFill);

// Stars: drawn without depth so the haze pass treats them as sky.
const stars = (() => {
  const n = 4000, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.randomDirection();
    v.y = Math.abs(v.y);
    v.multiplyScalar(9000).toArray(pos, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false });
  return new THREE.Points(geo, mat);
})();
scene.add(stars);

// Night sky: a dark-blue gradient dome that fades in after sunset. It's also in the sky probe scene, so the
// environment lighting turns moonlit blue instead of black.
const nightDomeMaterial = (() => {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, depthWrite: false, opacity: 0 });
  return mat;
})();
function createNightDome(radius: number) {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color('#050b1c'), horizon = new THREE.Color('#1b2c4c'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(horizon).lerp(zenith, Math.pow(Math.max(pos.getY(i) / radius, 0), 0.6)).multiplyScalar(0.6);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, nightDomeMaterial);
}
const nightDome = createNightDome(9500);
nightDome.renderOrder = -1;
scene.add(nightDome);
skyScene.add(createNightDome(900));

const water = createWater(cubeTarget.texture, new THREE.DataTexture(), MAX_WATER_DEPTH);
scene.add(water.mesh);

// --- World (regenerated from the World panel)
const params: WorldParams = { ...DEFAULT_PARAMS };
let world = new World(params, renderer);
scene.add(world.group);
water.uniforms.uDepth.value = world.depthTexture;

const post = createPost(renderer, scene, camera, cubeTarget.texture);

// --- Time of day and atmosphere
const settings = {
  /** Hours, 0-24. The sun rises behind the land and sets over the sea. */
  time: 17.5,
  /** Turns the whole sun path around the island. */
  sunRotation: 0,
  /** In-game hours per real minute; 0 = time stands still. */
  daySpeed: 0,
  turbidity: 1.5,
  rayleigh: 3,
  clouds: 0.38,
  exposure: renderer.toneMappingExposure,
  fogDensity: 0.0004,
};
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const lightColor = new THREE.Color();
let daylight = 1;

/** A long Nordic summer day: sunrise ~05:00 behind the land, sunset ~21:00 over the sea, a short dip at night. */
function sunPath(hours: number) {
  const DAWN = 5, DUSK = 21;
  if (hours >= DAWN && hours <= DUSK) {
    const phase = (hours - DAWN) / (DUSK - DAWN);
    return { elevation: 50 * Math.sin(Math.PI * phase), azimuth: 270 - phase * 180 };
  }
  const phase = ((hours - DUSK + 24) % 24) / (24 - DUSK + DAWN);
  return { elevation: -28 * Math.sin(Math.PI * phase), azimuth: 90 - phase * 180 };
}

function updateSun() {
  const path = sunPath(settings.time);
  const elevation = path.elevation;
  const azimuth = path.azimuth + settings.sunRotation;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  moonDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(-elevation, 20)), THREE.MathUtils.degToRad(azimuth + 180));

  const u = sky.material.uniforms;
  u.sunPosition.value.copy(sunDir);
  u.turbidity.value = settings.turbidity;
  u.rayleigh.value = settings.rayleigh;
  u.mieCoefficient.value = 0.0015;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = settings.clouds;
  u.cloudDensity.value = 0.55;

  daylight = THREE.MathUtils.smoothstep(elevation, -4, 6);
  const night = 1 - THREE.MathUtils.smoothstep(elevation, -9, -1);
  // Low sun = warm golden light; the moon is cool and dim.
  const warmth = THREE.MathUtils.smoothstep(elevation, 2, 30);
  const sunColor = new THREE.Color(1, 0.62 + 0.35 * warmth, 0.38 + 0.52 * warmth);
  const moonColor = new THREE.Color(0.55, 0.65, 1);
  lightDir.copy(daylight > 0.05 ? sunDir : moonDir);
  lightColor.copy(moonColor).multiplyScalar(0.6 * night).lerp(sunColor, daylight);
  sun.color.copy(lightColor);
  sun.intensity = daylight > 0.05 ? 3.2 * daylight : 2.2;
  nightFill.intensity = 1.4 * night;
  (stars.material as THREE.PointsMaterial).opacity = night;
  nightDomeMaterial.opacity = night;
  renderer.toneMappingExposure = settings.exposure * (1 + 1.6 * night);

  water.uniforms.uSunDir.value.copy(lightDir);
  water.uniforms.uSunColor.value.copy(lightColor);
  post.atmosphere.uShaftStrength.value = shaftStrength.value * daylight;

  cubeCamera.update(renderer, skyScene);
  envTarget?.dispose();
  envTarget = pmrem.fromScene(skyScene);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;
}
const shaftStrength = { value: post.atmosphere.uShaftStrength.value };
updateSun();

// --- Controls panel
const gui = new GUI({ title: 'Meadows' });

const worldGui = gui.addFolder('World');
worldGui.add(params, 'seed', 0, 999999, 1);
worldGui.add(params, 'hills', 0, 2.5, 0.05);
worldGui.add(params, 'mountains', 0, 2.5, 0.05);
worldGui.add(params, 'rivers', 0, 6, 1);
worldGui.add(params, 'rocks', 0, 3, 0.05).name('rockiness');
worldGui.add(params, 'forest', 0, 1, 0.01).name('forest cover');
worldGui.add(params, 'groves', 0, 2, 0.05).name('meadow trees');
worldGui.add(params, 'flowers', 0, 2, 0.05);
const actions = {
  regenerate: () => regenerate(),
  randomSeed: () => {
    params.seed = Math.floor(Math.random() * 1000000);
    worldGui.controllersRecursive().forEach((c) => c.updateDisplay());
    regenerate();
  },
};
worldGui.add(actions, 'regenerate').name('⟳ Regenerate');
worldGui.add(actions, 'randomSeed').name('🎲 Random seed');

const timeGui = gui.addFolder('Time & weather');
const timeCtrl = timeGui.add(settings, 'time', 0, 24, 0.05).name('time of day').onChange(updateSun);
timeGui.add(settings, 'daySpeed', 0, 60, 0.5).name('day speed (h/min)');
timeGui.add(settings, 'sunRotation', -180, 180, 1).name('sun direction').onChange(updateSun);
timeGui.add(settings, 'clouds', 0, 1, 0.01).onChange(updateSun);
timeGui.add(settings, 'fogDensity', 0, 0.003, 0.0001).name('haze').onChange((v: number) => (post.atmosphere.uFogDensity.value = v));
timeGui.add(post.atmosphere.uTintStrength, 'value', 0, 1, 0.01).name('cyan / gold tint');
timeGui.add(wind.uWindStrength, 'value', 0, 3, 0.01).name('wind');

const postGui = gui.addFolder('Effects');
postGui.add(settings, 'exposure', 0.1, 2, 0.01).onChange(updateSun);
postGui.add(settings, 'turbidity', 0, 20, 0.1).onChange(updateSun);
postGui.add(settings, 'rayleigh', 0, 4, 0.01).onChange(updateSun);
postGui.add(shaftStrength, 'value', 0, 3, 0.01).name('light shafts').onChange(updateSun);
postGui.add(post.atmosphere.uAOStrength, 'value', 0, 1, 0.01).name('ambient occlusion');
postGui.add(post.ao.uRadius, 'value', 0.2, 5, 0.05).name('AO radius');
postGui.add(post.ao.uIntensity, 'value', 0, 4, 0.05).name('AO intensity');
postGui.add(post.bloom, 'strength', 0, 2, 0.01).name('bloom');
postGui.add(post.bloom, 'threshold', 0, 8, 0.05).name('bloom threshold');
postGui.add(post.grade.uSaturation, 'value', 0, 2, 0.01).name('saturation');
postGui.add(post.grade.uContrast, 'value', 0.5, 1.5, 0.01).name('contrast');
postGui.add(post.grade.uWarmth, 'value', 0, 0.3, 0.005).name('warmth');
postGui.add(post.grade.uVignette, 'value', 0, 0.8, 0.01).name('vignette');
postGui.close();

const busy = document.getElementById('busy')!;
function regenerate() {
  busy.style.display = 'flex';
  // Let the overlay paint before the (blocking) generation starts.
  requestAnimationFrame(() =>
    setTimeout(() => {
      scene.remove(world.group);
      world.dispose();
      world = new World(params, renderer);
      scene.add(world.group);
      water.uniforms.uDepth.value = world.depthTexture;
      camera.position.y = Math.max(world.height(camera.position.x, camera.position.z), 0) + (flying ? 20 : EYE_HEIGHT);
      world.update(camera, true);
      busy.style.display = 'none';
    }, 30),
  );
}

// --- Camera controls
const controls = new PointerLockControls(camera, renderer.domElement);
const hint = document.getElementById('hint')!;
renderer.domElement.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => (hint.style.opacity = '0'));
controls.addEventListener('unlock', () => (hint.style.opacity = '1'));

const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

const EYE_HEIGHT = 1.7;

// Start on the meadow looking out to sea. ?cam=x,heightAboveGround,z,tx,ty,tz overrides (handy for screenshots),
// and ?time=hours sets the time of day.
const query = new URLSearchParams(location.search);
const camParam = query.get('cam')?.split(',').map(Number);
if (query.has('time')) {
  settings.time = Number(query.get('time'));
  timeCtrl.updateDisplay();
  updateSun();
}
if (camParam?.length === 6 && camParam.every(Number.isFinite)) {
  // y is height above the ground here, so shots can't end up underground.
  const [x, y, z] = camParam;
  camera.position.set(x, Math.max(world.height(x, z), 0) + Math.max(y, 1.7), z);
  camera.lookAt(camParam[3], camParam[4], camParam[5]);
} else {
  camera.position.set(-30, world.height(-30, 0) + EYE_HEIGHT, 0);
  camera.lookAt(400, 4, -60);
}

// Walk (default) or fly; F toggles. Walking follows the ground with gravity and jumping.
// A ?cam= view above walking height starts in fly mode so it holds its altitude.
let flying = (camParam?.[1] ?? 0) > EYE_HEIGHT + 0.5;
let verticalSpeed = 0;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') {
    flying = !flying;
    verticalSpeed = 0;
  }
});

const move = new THREE.Vector3();
function updateCamera(dt: number) {
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = flying ? (sprint ? 90 : 18) : sprint ? 10 : 4.5;
  move.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyW')) - Number(keys.has('KeyS')));
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    controls.moveRight(move.x);
    controls.moveForward(move.z);
  }

  const ground = Math.max(world.height(camera.position.x, camera.position.z), 0) + EYE_HEIGHT;
  if (flying) {
    camera.position.y += (Number(keys.has('Space')) - Number(keys.has('KeyC'))) * speed * dt;
  } else {
    const onGround = camera.position.y <= ground + 0.05;
    if (onGround && keys.has('Space')) verticalSpeed = 6;
    verticalSpeed -= 20 * dt;
    camera.position.y += verticalSpeed * dt;
  }
  if (camera.position.y < ground) {
    camera.position.y = ground;
    verticalSpeed = 0;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
let sinceSunUpdate = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  updateCamera(dt);

  // Advance the clock; re-lighting rebuilds the sky probes, so do it a few times a second, not every frame.
  if (settings.daySpeed > 0) {
    settings.time = (settings.time + (settings.daySpeed / 60) * dt) % 24;
    sinceSunUpdate += dt;
    if (sinceSunUpdate > 0.2) {
      sinceSunUpdate = 0;
      timeCtrl.updateDisplay();
      updateSun();
    }
  }

  water.uniforms.uTime.value = timer.getElapsed();
  wind.uTime.value = timer.getElapsed();
  camera.updateMatrixWorld();
  world.update(camera);

  // Inside a forest the haze thickens; ease toward it so walking in and out doesn't pop.
  const altitude = camera.position.y - world.height(camera.position.x, camera.position.z);
  const forestHere = world.fns.forest(camera.position.x, camera.position.z) * (1 - THREE.MathUtils.smoothstep(altitude, 5, 40));
  post.atmosphere.uForest.value += (forestHere - post.atmosphere.uForest.value) * Math.min(dt * 1.5, 1);

  // Keep the shadow frustum centered on the viewer.
  sun.target.position.copy(camera.position);
  sun.position.copy(camera.position).addScaledVector(lightDir, 500);
  stars.position.copy(camera.position);
  nightDome.position.copy(camera.position);

  sunLight.uSunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
  sunLight.uSunColor.value.copy(lightColor);
  post.render(lightDir, lightColor);
});

// Fill grass and ground cover before the first frame so the opening view isn't bare.
camera.updateMatrixWorld();
world.update(camera, true);

// Debug handle for automated screenshots.
Object.assign(window, {
  __app: { camera, scene, renderer, settings, updateSun, cubeTarget, skyScene, post, params, regenerate, get world() { return world; } },
});
