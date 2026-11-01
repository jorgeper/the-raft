import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import GUI from 'lil-gui';
import { createWater } from './water';
import { wind, sunLight } from './wind';
import { createPost } from './post';
import { World, MAX_WATER_DEPTH } from './world';
import { DEFAULT_PARAMS, type WorldParams } from './worldgen';
import { Torch } from './torch';
import { Minimap } from './minimap';
import { loadScannedRocks, rockMoss } from './scanned-rocks';
import { Persist } from './persist';
import { createSky } from './sky';
import { Character, type MotionState } from './character';
import { loadGroundTextures, groundUniforms } from './ground';
import { Motes } from './motes';
import { loadPlants } from './plants';

// Panel settings persist across reloads; ?defaults ignores (and doesn't touch) the stored ones.
const persist = new Persist(!new URLSearchParams(location.search).has('defaults'));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// --- Display: the view fills the window up to a configurable maximum size, centered when the window is larger.
const display = {
  maxWidth: 2560,
  maxHeight: 1440,
  /** Multiplier on the screen's pixel density (capped at 2); lower is faster, higher is sharper. */
  renderScale: 1,
  fov: 60,
  showMinimap: true,
  minimapSize: 220,
  /** The settings panel (H toggles). */
  showPanel: true,
};
persist.bind('display', display, ['maxWidth', 'maxHeight', 'renderScale', 'fov', 'showMinimap', 'minimapSize', 'showPanel']);
const stage = document.getElementById('stage')!;
const viewSize = () => ({ width: Math.min(window.innerWidth, display.maxWidth), height: Math.min(window.innerHeight, display.maxHeight) });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * display.renderScale);
renderer.setSize(viewSize().width, viewSize().height);
// Neutral (Khronos PBR) keeps hues saturated where ACES pulls bright blues and greens toward white; Valheim's look is
// saturated.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.65;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(display.fov, viewSize().width / viewSize().height, 0.1, 20000);

// --- Sky, environment lighting, and water reflections all come from one sky model.
const sky = createSky();
sky.mesh.scale.setScalar(10000);
scene.add(sky.mesh);

const skyScene = new THREE.Scene();
sky.probeMesh.scale.setScalar(1000); // must sit beyond the cube camera near plane
skyScene.add(sky.probeMesh);
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

const water = createWater(cubeTarget.texture, new THREE.DataTexture(), MAX_WATER_DEPTH);
scene.add(water.mesh);

// --- World (regenerated from the World panel)
const params: WorldParams = { ...DEFAULT_PARAMS };
persist.bind('world', params, Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[]);
persist.bind('moss', rockMoss.uMossAmount, ['value']);
// Photoscanned rocks are fetched by `npm run assets`; without them the world uses procedural rocks.
const characterLoad = Character.load();
const groundLoad = loadGroundTextures();
const plantsLoad = loadPlants();
const scannedRocks = await loadScannedRocks();
await Promise.all([groundLoad, plantsLoad]);
let world = new World(params, renderer, scannedRocks);
/** The world settings the current world was built from, to tell whether a reset needs a regenerate. */
let builtParams = JSON.stringify(params);
scene.add(world.group);
water.uniforms.uDepth.value = world.depthTexture;

// Glowing motes draw over the haze so it doesn't fog them out.
const overlay = new THREE.Scene();
const post = createPost(renderer, scene, camera, cubeTarget.texture, sun, overlay);

// The player's eye: mouse look and WASD move this; the camera follows it in first person, or orbits behind the
// character in third person.
const player = new THREE.Object3D();
// The Viking (missing model files just mean no body).
const character = await characterLoad;
if (character) scene.add(character.root);

// Pollen and dust in the sunlight, fireflies at night (scaled by whimsy).
const motes = new Motes();
motes.setSceneDepth(post.sceneDepth);
overlay.add(motes.points);

// Torch (T): the flame model rides on the camera (or in the character's hand), its lights live in the world.
const torch = new Torch();
scene.add(camera);
camera.add(torch.object);
scene.add(torch.world);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') torch.toggle();
});
const volumetric = { value: 1 };

// --- Time of day and atmosphere
const settings = {
  /** Hours, 0-24. The sun rises behind the land and sets over the sea. */
  time: 17.5,
  /** Turns the whole sun path around the island. */
  sunRotation: 0,
  /** In-game hours per real minute; 0 = time stands still. */
  daySpeed: 0,
  clouds: 0.38,
  exposure: renderer.toneMappingExposure,
  fogDensity: 0.0008,
  /** Valheim's dreamy side: two-tone haze, stronger beams, lens flares, soft glow, floating motes and fireflies. */
  whimsy: 0.6,
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

  // Rose-gold palette before noon, magenta-violet after.
  sky.update(sunDir, elevation, settings.time >= 13 || settings.time < 1, settings.clouds);

  daylight = THREE.MathUtils.smoothstep(elevation, -4, 6);
  const night = 1 - THREE.MathUtils.smoothstep(elevation, -9, -1);
  // Low sun = warm golden light; the moon is cool and dim.
  const warmth = THREE.MathUtils.smoothstep(elevation, 2, 30);
  // Valheim's sunlight stays golden even at noon.
  const sunColor = new THREE.Color(1, 0.62 + 0.3 * warmth, 0.38 + 0.42 * warmth);
  const moonColor = new THREE.Color(0.55, 0.65, 1);
  lightDir.copy(daylight > 0.05 ? sunDir : moonDir);
  lightColor.copy(moonColor).multiplyScalar(0.6 * night).lerp(sunColor, daylight);
  sun.color.copy(lightColor);
  // Strong sun against modest sky fill, so shadows and light beams have real contrast.
  sun.intensity = daylight > 0.05 ? 7.5 * daylight : 2.2;
  nightFill.intensity = 1.4 * night;
  (stars.material as THREE.PointsMaterial).opacity = night;
  renderer.toneMappingExposure = settings.exposure * (1 + 1.6 * night);

  water.uniforms.uSunDir.value.copy(lightDir);
  water.uniforms.uSunColor.value.copy(lightColor);
  post.atmosphere.uShaftStrength.value = shaftStrength.value * daylight;
  post.atmosphere.uVolumetric.value = volumetric.value * daylight;

  cubeCamera.update(renderer, skyScene);
  envTarget?.dispose();
  envTarget = pmrem.fromScene(skyScene);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.4;
}
const shaftStrength = { value: post.atmosphere.uShaftStrength.value };
persist.bind('time', settings, ['time', 'sunRotation', 'daySpeed', 'clouds', 'exposure', 'fogDensity', 'whimsy']);
post.setWhimsy(settings.whimsy);
persist.bind('tint', post.atmosphere.uTintStrength, ['value']);
persist.bind('wind', wind.uWindStrength, ['value']);
persist.bind('torch', torch, ['on', 'brightness', 'embersOn', 'smokeOn']);
persist.bind('volumetric', volumetric, ['value']);
persist.bind('shafts', shaftStrength, ['value']);
persist.bind('aoStrength', post.atmosphere.uAOStrength, ['value']);
persist.bind('aoRadius', post.ao.uRadius, ['value']);
persist.bind('aoIntensity', post.ao.uIntensity, ['value']);
persist.bind('bloom', post.bloom, ['strength', 'threshold']);
persist.bind('saturation', post.grade.uSaturation, ['value']);
persist.bind('contrast', post.grade.uContrast, ['value']);
persist.bind('warmth', post.grade.uWarmth, ['value']);
persist.bind('vignette', post.grade.uVignette, ['value']);
post.atmosphere.uFogDensity.value = settings.fogDensity;
updateSun();

// --- Controls panel
const gui = new GUI({ title: 'Meadows' });
gui.add(settings, 'whimsy', 0, 1.5, 0.01).name('✨ whimsy').onChange((v: number) => post.setWhimsy(v));

const worldGui = gui.addFolder('World');
worldGui.add(params, 'seed', 0, 999999, 1);
worldGui.add(params, 'hills', 0, 2.5, 0.05);
worldGui.add(params, 'mountains', 0, 2.5, 0.05);
worldGui.add(params, 'rivers', 0, 6, 1);
worldGui.add(params, 'rocks', 0, 3, 0.05).name('rockiness');
worldGui.add(params, 'forest', 0, 1, 0.01).name('forest cover');
worldGui.add(params, 'groves', 0, 2, 0.05).name('meadow groves');
worldGui.add(params, 'bigTrees', 0, 2, 0.05).name('big trees');
worldGui.add(params, 'smallTrees', 0, 2, 0.05).name('small trees');
worldGui.add(params, 'bushes', 0, 3, 0.05);
worldGui.add(params, 'flowers', 0, 2, 0.05);
worldGui.add(rockMoss.uMossAmount, 'value', 0, 1, 0.01).name('moss on rocks');
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

const torchGui = gui.addFolder('Torch');
torchGui.add(torch, 'on').name('lit (T)').listen();
torchGui.add(torch, 'brightness', 0, 3, 0.05);
torchGui.add(torch, 'embersOn').name('embers');
torchGui.add(torch, 'smokeOn').name('smoke');
torchGui.close();

const postGui = gui.addFolder('Effects');
postGui.add(settings, 'exposure', 0.1, 2, 0.01).onChange(updateSun);
postGui.add(volumetric, 'value', 0, 3, 0.01).name('volumetric light').onChange(updateSun);
postGui.add(shaftStrength, 'value', 0, 3, 0.01).name('sun glare shafts').onChange(updateSun);
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

const movement = {
  mode: 'walk' as 'walk' | 'fly',
  walkSpeed: 4.5,
  runSpeed: 10,
  flySpeed: 18,
  flyBoost: 5,
  sensitivity: 1,
  /** First person, or third person over the character's shoulder (V toggles). */
  view: 'third' as 'first' | 'third',
  /** Third-person camera distance (mouse wheel). */
  distance: 3.6,
};
persist.bind('movement', movement, ['mode', 'walkSpeed', 'runSpeed', 'flySpeed', 'flyBoost', 'sensitivity', 'view', 'distance']);
const controlsGui = gui.addFolder('Controls');
controlsGui.add(movement, 'mode', ['walk', 'fly']).name('mode (F)').listen().onChange(() => (verticalSpeed = 0));
controlsGui.add(movement, 'view', ['first', 'third']).name('view (V)').listen();
controlsGui.add(movement, 'distance', 1.5, 10, 0.1).name('camera distance').listen();
controlsGui.add(movement, 'walkSpeed', 1, 15, 0.1).name('walk speed (m/s)');
controlsGui.add(movement, 'runSpeed', 2, 30, 0.1).name('run speed (m/s)');
controlsGui.add(movement, 'flySpeed', 2, 100, 1).name('fly speed (m/s)');
controlsGui.add(movement, 'flyBoost', 1, 10, 0.5).name('fly Shift boost ×');
controlsGui.add(movement, 'sensitivity', 0.1, 3, 0.05).name('mouse sensitivity').onChange((v: number) => (controls.pointerSpeed = v));
controlsGui.close();

function applyDisplay() {
  const { width, height } = viewSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * display.renderScale);
  renderer.setSize(width, height);
  post.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = display.fov;
  camera.updateProjectionMatrix();
  minimap.setSize(display.minimapSize);
  minimap.setVisible(display.showMinimap);
  gui.show(display.showPanel);
}
const displayGui = gui.addFolder('Display');
displayGui.add(display, 'maxWidth', 640, 3840, 10).name('max width (px)').onChange(applyDisplay);
displayGui.add(display, 'maxHeight', 360, 2160, 10).name('max height (px)').onChange(applyDisplay);
displayGui.add(display, 'renderScale', 0.25, 1.5, 0.05).name('render scale').onChange(applyDisplay);
displayGui.add(display, 'fov', 30, 100, 1).name('field of view').onChange(applyDisplay);
displayGui.add(display, 'showMinimap').name('minimap (M)').listen().onChange(applyDisplay);
displayGui.add(display, 'minimapSize', 120, 480, 10).name('minimap size').onChange(applyDisplay);
displayGui.close();

// --- Minimap: click to travel there.
const minimap = new Minimap(display.minimapSize);
stage.appendChild(minimap.element);
minimap.setWorld(world.fns);
minimap.onNavigate = (x, z) => {
  const ground = Math.max(world.height(x, z), 0);
  const altitude = player.position.y - Math.max(world.height(player.position.x, player.position.z), 0);
  player.position.set(x, ground + (movement.mode === 'fly' ? Math.max(altitude, 10) : EYE_HEIGHT), z);
  verticalSpeed = 0;
  snapView();
  world.update(camera, true);
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    display.showMinimap = !display.showMinimap;
    applyDisplay();
  }
  if (e.code === 'KeyH') {
    display.showPanel = !display.showPanel;
    applyDisplay();
  }
});

const busy = document.getElementById('busy')!;
function regenerate() {
  busy.style.display = 'flex';
  // Let the overlay paint before the (blocking) generation starts.
  requestAnimationFrame(() =>
    setTimeout(() => {
      scene.remove(world.group);
      world.dispose();
      world = new World(params, renderer, scannedRocks);
      builtParams = JSON.stringify(params);
      scene.add(world.group);
      water.uniforms.uDepth.value = world.depthTexture;
      player.position.y = Math.max(world.height(player.position.x, player.position.z), 0) + (movement.mode === 'fly' ? 20 : EYE_HEIGHT);
      snapView();
      world.update(camera, true);
      minimap.setWorld(world.fns);
      busy.style.display = 'none';
    }, 30),
  );
}

// --- Camera controls
const controls = new PointerLockControls(player as unknown as THREE.Camera, renderer.domElement);
controls.pointerSpeed = movement.sensitivity;
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
  player.position.set(x, Math.max(world.height(x, z), 0) + Math.max(y, 1.7), z);
  lookAt(player, camParam[3], camParam[4], camParam[5]);
} else {
  player.position.set(-30, world.height(-30, 0) + EYE_HEIGHT, 0);
  lookAt(player, 400, 4, -60);
}
// ?view=first|third picks the view for a shot.
if (query.get('view') === 'first' || query.get('view') === 'third') movement.view = query.get('view') as 'first' | 'third';

/** Aims an object the way a camera looks (down its -Z), unlike Object3D.lookAt which points +Z at the target. */
function lookAt(o: THREE.Object3D, x: number, y: number, z: number) {
  const m = new THREE.Matrix4().lookAt(o.position, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0));
  o.quaternion.setFromRotationMatrix(m);
}

// Walk (default) or fly; F toggles. Walking follows the ground with gravity and jumping.
// A ?cam= view above walking height starts in fly mode so it holds its altitude.
if ((camParam?.[1] ?? 0) > EYE_HEIGHT + 0.5) movement.mode = 'fly';
let verticalSpeed = 0;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') {
    movement.mode = movement.mode === 'fly' ? 'walk' : 'fly';
    verticalSpeed = 0;
  }
  if (e.code === 'KeyV') movement.view = movement.view === 'first' ? 'third' : 'first';
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (movement.view !== 'third') return;
  movement.distance = THREE.MathUtils.clamp(movement.distance * Math.exp(e.deltaY * 0.001), 1.5, 10);
}, { passive: true });

const move = new THREE.Vector3();
/** Moves the player's eye; returns whether it stands on the ground and whether a jump started this frame. */
function updateCamera(dt: number) {
  let jumped = false;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const flying = movement.mode === 'fly';
  const speed = flying ? movement.flySpeed * (sprint ? movement.flyBoost : 1) : sprint ? movement.runSpeed : movement.walkSpeed;
  move.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyW')) - Number(keys.has('KeyS')));
  if (move.lengthSq() > 0) {
    // The controls move along the player's matrix, which nothing else updates (the player isn't in the scene).
    player.updateMatrix();
    move.normalize().multiplyScalar(speed * dt);
    controls.moveRight(move.x);
    controls.moveForward(move.z);
  }

  const ground = Math.max(world.height(player.position.x, player.position.z), 0) + EYE_HEIGHT;
  if (flying) {
    player.position.y += (Number(keys.has('Space')) - Number(keys.has('KeyC'))) * speed * dt;
  } else {
    const onGround = player.position.y <= ground + 0.05;
    if (onGround && keys.has('Space')) {
      verticalSpeed = 6;
      jumped = true;
    }
    verticalSpeed -= 20 * dt;
    player.position.y += verticalSpeed * dt;
  }
  if (player.position.y < ground) {
    player.position.y = ground;
    verticalSpeed = 0;
  }
  return { grounded: player.position.y <= ground + 0.05, jumped };
}

// --- View: first person puts the camera at the eye; third person hangs it on a smoothed spring arm over the right
// shoulder that shortens rather than dip into a hill.
const SHOULDER = new THREE.Vector3(0.4, 0.12, 0);
/** The third-person camera looks a little below the player's aim, so the whole character stays in frame. */
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.17);
const pivot = new THREE.Vector3();
const desired = new THREE.Vector3();
const armDir = new THREE.Vector3();
const probe = new THREE.Vector3();
const tilted = new THREE.Quaternion();
const feet = new THREE.Vector3();
const lastFeet = new THREE.Vector3();
const travel = new THREE.Vector3();
const facing = new THREE.Vector3();
let viewBlend = movement.view === 'third' ? 1 : 0;
let smoothArm = movement.distance;

function thirdPerson() {
  return movement.view === 'third' && movement.mode === 'walk' && character !== null;
}

/** Places the camera for the current view; `snap` skips the smoothing (after teleports and on load). */
function updateView(dt: number, snap = false) {
  const third = thirdPerson();
  viewBlend = snap ? Number(third) : THREE.MathUtils.clamp(viewBlend + (third ? dt : -dt) * 4, 0, 1);
  camera.quaternion.copy(player.quaternion);
  if (viewBlend <= 0) {
    camera.position.copy(player.position);
  } else {
    // Orbit a point just above the shoulders, so looking around swings the camera around the character.
    pivot.copy(player.position).y -= EYE_HEIGHT - 1.6;
    armDir.set(SHOULDER.x, SHOULDER.y, 1).applyQuaternion(player.quaternion);
    // Shorten the arm where the terrain would come between the camera and the character.
    let length = movement.distance;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * movement.distance;
      probe.copy(pivot).addScaledVector(armDir, t);
      if (probe.y < Math.max(world.height(probe.x, probe.z), 0) + 0.35) {
        length = Math.max(((i - 1) / 8) * movement.distance, 0.6);
        break;
      }
    }
    smoothArm = snap ? length : length < smoothArm ? length : smoothArm + (length - smoothArm) * Math.min(dt * 3, 1);
    desired.copy(pivot).addScaledVector(armDir, smoothArm * viewBlend);
    camera.quaternion.slerp(tilted.copy(player.quaternion).multiply(TILT), viewBlend);
    camera.position.lerpVectors(player.position, desired, viewBlend);
    const floor = Math.max(world.height(camera.position.x, camera.position.z), 0) + 0.35;
    if (camera.position.y < floor) camera.position.y = floor;
  }
  camera.updateMatrixWorld();
}
function snapView() {
  lastFeet.copy(player.position).y -= EYE_HEIGHT;
  character?.face(player.getWorldDirection(facing).negate().setY(0));
  updateView(0, true);
}

/** Moves the character to the player and picks its animation; hands the torch to it in third person. */
function updateCharacter(dt: number, motion: { grounded: boolean; jumped: boolean }) {
  feet.copy(player.position).y -= EYE_HEIGHT;
  travel.subVectors(feet, lastFeet).setY(0);
  lastFeet.copy(feet);
  const third = thirdPerson();
  if (character) {
    const speed = dt > 0 ? travel.length() / dt : 0;
    const state: MotionState = { speed: speed < 60 ? speed : 0, grounded: motion.grounded, jumped: motion.jumped, torch: torch.on };
    character.update(dt, feet, travel, state);
    // Shown once the camera has pulled back far enough not to clip into the head.
    character.visible = third && viewBlend > 0.35;
    character.root.updateMatrixWorld(true);
  }
  if (third && character && viewBlend > 0.35) torch.attach(character.handBone, 'hand');
  else torch.attach(camera, 'view');
  return third && character ? character.root.getWorldDirection(facing) : undefined;
}

window.addEventListener('resize', applyDisplay);
applyDisplay();

// Save whenever a panel edit is committed, after the keyboard toggles (T, F, M, V, H), and when leaving the page
// (which also catches the clock moving on its own).
gui.onFinishChange(() => persist.save());
window.addEventListener('keyup', (e) => {
  if (['KeyT', 'KeyF', 'KeyM', 'KeyV', 'KeyH'].includes(e.code)) persist.save();
});
window.addEventListener('pagehide', () => persist.save());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist.save());

function resetToDefaults() {
  persist.reset();
  post.atmosphere.uFogDensity.value = settings.fogDensity;
  post.setWhimsy(settings.whimsy);
  controls.pointerSpeed = movement.sensitivity;
  verticalSpeed = 0;
  updateSun();
  applyDisplay();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  if (JSON.stringify(params) !== builtParams) regenerate();
}
gui.add({ reset: resetToDefaults }, 'reset').name('↺ Reset to defaults');

const lookDir = new THREE.Vector3();
const timer = new THREE.Timer();
let sinceSunUpdate = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const motion = updateCamera(dt);
  updateView(dt);
  const torchAim = updateCharacter(dt, motion);

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
  sky.uniforms.uTime.value = timer.getElapsed();
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

  const pixelsPerMeter = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  torch.update(camera, timer.getElapsed(), dt, pixelsPerMeter, torchAim);
  motes.update(timer.getElapsed(), camera, lightDir, daylight, Math.min(settings.whimsy, 1.2), pixelsPerMeter);
  minimap.update(camera, camera.getWorldDirection(lookDir));
  post.atmosphere.uTorchPos.value.copy(torch.flameWorld);
  post.atmosphere.uTorchColor.value.copy(torch.flameColor);

  sunLight.uSunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
  sunLight.uSunColor.value.copy(lightColor);
  post.render(lightDir, lightColor);
});

// Fill grass and ground cover before the first frame so the opening view isn't bare.
snapView();
world.update(camera, true);

// Debug handle for automated screenshots.
Object.assign(window, {
  __app: { camera, scene, renderer, settings, updateSun, sky, cubeTarget, skyScene, post, params, regenerate, display, applyDisplay, movement, torch, persist, player, character, snapView, lookAt, groundUniforms, resetToDefaults, get world() { return world; } },
});
