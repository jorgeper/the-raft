import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import GUI from 'lil-gui';
import { createWater, addRipple } from './water';
import { wind, sunLight } from './wind';
import { createPost } from './post';
import { World } from './world';
import { DEFAULT_PARAMS, type WorldParams } from './worldgen';
import { Torch } from './torch';
import { Minimap } from './minimap';
import { loadScannedRocks, rockMoss, setRockPonds } from './scanned-rocks';
import { Persist } from './persist';
import { createSky, CLOUD_HEIGHT } from './sky';
import { Character, type MotionState } from './character';
import { loadGroundTextures, groundUniforms } from './ground';
import { CloudPass } from './clouds';
import { Motes } from './motes';
import { loadPlants } from './plants';
import { QUALITY_PRESETS, quality, setQuality, type QualityLevel } from './quality';
import { FpsMeter } from './fps';
import { SunShadows, seeFarCasters } from './cascades';
import { Weather, weatherUniforms, type WeatherMode } from './weather';
import { Rain, Splashes } from './rain';
import { SeedFluff } from './fluff';

// Panel settings persist across reloads; ?defaults ignores (and doesn't touch) the stored ones.
const persist = new Persist(!new URLSearchParams(location.search).has('defaults'));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// --- Display: the view fills the window up to a configurable maximum size, centered when the window is larger.
const display = {
  maxWidth: 2560,
  maxHeight: 1440,
  /** Multiplier on the screen's pixel density (capped at 2); lower is faster, higher is sharper. */
  renderScale: 0.85,
  fov: 60,
  showMinimap: true,
  minimapSize: 220,
  /** The settings panel (H toggles). */
  showPanel: true,
  /** Graphics preset: scales resolution, shadows, grass, ferns, beams, AO, glow and motes together. */
  quality: 'medium' as QualityLevel,
  /** Frame-rate readout in the corner (P toggles). */
  showFps: true,
  /** Temporal anti-aliasing: steadies shimmering grass, leaf edges and the noise of beams and AO. Swaying grass and
   * leaves reproject with their wind motion, so they stay sharp. */
  taa: true,
};
persist.bind('display', display, ['maxWidth', 'maxHeight', 'renderScale', 'fov', 'showMinimap', 'minimapSize', 'showPanel', 'quality', 'showFps', 'taa']);
if (!(display.quality in QUALITY_PRESETS)) display.quality = 'medium';
setQuality(display.quality);
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
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
// A sharp near cascade (the sun itself) plus a far one out toward the horizon, sized by the quality preset.
const sunShadows = new SunShadows(sun, scene);
seeFarCasters(camera);
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

// Drawn by its own pass after the opaque scene, so it can refract and reflect it.
const water = createWater(cubeTarget.texture);
water.setReflectionSteps(quality.waterReflectionSteps);

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
water.setPonds(world.fns.ponds);
water.setRivers(world.fns.riverCenters);
setRockPonds(world.fns.ponds);
/** The world settings the current world was built from, to tell whether a reset needs a regenerate. */
let builtParams = JSON.stringify(params);
scene.add(world.group);

// Glowing motes draw over the haze so it doesn't fog them out.
const overlay = new THREE.Scene();
const clouds = new CloudPass(camera, sky.uniforms);
// Things that move on their own get motion vectors for the TAA (the character joins once it has loaded).
let characterRoot: THREE.Object3D | null = null;
const movers = () => [characterRoot, world.deer.group, world.life.group, world.pondLife.group];
const post = createPost(renderer, scene, camera, cubeTarget.texture, sunShadows, overlay, water, clouds, movers);
post.setQuality(quality.volumetricSteps, quality.aoScale, quality.glow, quality.cloudSteps);
sky.setVolumetricClouds(quality.cloudSteps > 0);

// The player's eye: mouse look and WASD move this; the camera follows it in first person, or orbits behind the
// character in third person.
const player = new THREE.Object3D();
// The Viking (missing model files just mean no body).
const character = await characterLoad;
if (character) scene.add(character.root);
characterRoot = character?.root ?? null;

// Pollen and dust in the sunlight, fireflies at night (scaled by whimsy).
const motes = new Motes();
motes.setSceneDepth(post.sceneDepth);
overlay.add(motes.points);
const rain = new Rain();
rain.setSceneDepth(post.sceneDepth);
overlay.add(rain.lines);
// Splashes where the drops land (follows regenerate through the closure).
const splashes = new Splashes((x, z) => world.height(x, z));
// Dandelion and thistle down drifting over the meadows on fine days.
const fluff = new SeedFluff();
fluff.setSceneDepth(post.sceneDepth);
overlay.add(fluff.points);
splashes.setSceneDepth(post.sceneDepth);
overlay.add(splashes.points);
const weather = new Weather();

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
  time: 8,
  /** Turns the whole sun path around the island. */
  sunRotation: 0,
  /** In-game hours per real minute; 0 = time stands still. */
  daySpeed: 0,
  clouds: 0.38,
  exposure: renderer.toneMappingExposure,
  /**
   * Seeing in the dark, a game's kindness rather than physics: dark views (night, deep forest) open the exposure up
   * and the grade lifts the deepest shade. 0 = off, 1 = default, 2 = strong.
   */
  nightVision: 1,
  /** Master switch for seeing in the dark: off restores plain night (no eye adaptation, shadow lift or extra moonlight). */
  nightVisionOn: true,
  fogDensity: 0.00045,
  /** Valheim's dreamy side: two-tone haze, stronger beams, lens flares, soft glow, floating motes and fireflies. */
  whimsy: 0.6,
  /** Pollen and dust motes by day, and seed fluff on the wind (fireflies at night stay). */
  pollen: true,
  /** Mist lying on the ground: amount, layer height (m), and how broken into banks it is. */
  groundFog: 0.22,
  groundFogHeight: 3,
  groundFogPatchy: 0.6,
  /** 'auto' drifts between clear, fair, cloudy, overcast and rain by itself; 'manual' uses the cloud slider. */
  weather: 'auto' as WeatherMode,
  /** Northern lights on clear nights (0 = never). */
  aurora: 0.7,
  /** 0 = new moon, 0.5 = full; advances a little each night. */
  moonPhase: 0.42,
};
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const lightColor = new THREE.Color();
/**
 * The sun as the air, water and blades see it: under overcast the light is diffuse, so the haze's sunward glow, the
 * glitter on water and the grass's translucency fade and lose their warmth (they had tinted rainy haze pink).
 */
const scatterSun = new THREE.Color();
let daylight = 1;
/** Exposure before eye adaptation, and the adaptation factor (dips a little while you look into the sun). */
let baseExposure = 0.65, eyeAdapt = 1;

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

/** How much seeing in the dark applies (0 when switched off). */
const nightVision = () => (settings.nightVisionOn ? settings.nightVision : 0);
/** 0 by day, 1 at night and in twilight: the eye only adapts to the dark when it's actually dark out. */
let darkHours = 0;
/** Smoothed log2 of the metered frame brightness (NaN until the meter has a reading). */
let meteredLog = NaN;
/** The grade's share of seeing in the dark: lifts the deepest shade (the exposure share is in the frame loop). */
function applyNightVision() {
  // Mostly at night: by day a strong toe amplified the dark gaps between grass blades into shimmer.
  post.grade.uShadowLift.value = 0.45 * nightVision() * (0.25 + 0.75 * darkHours);
}

function updateSun() {
  const path = sunPath(settings.time);
  const elevation = path.elevation;
  const azimuth = path.azimuth + settings.sunRotation;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  moonDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(-elevation, 20)), THREE.MathUtils.degToRad(azimuth + 180));

  // Rose-gold palette before noon, magenta-violet after.
  const overcast = weather.overcast;
  sky.update(sunDir, elevation, settings.time >= 13 || settings.time < 1, weather.clouds, overcast);
  sky.uniforms.uSunDisc.value = 12 * (1 - overcast);

  daylight = THREE.MathUtils.smoothstep(elevation, -4, 6);
  const night = 1 - THREE.MathUtils.smoothstep(elevation, -9, -1);
  // Low sun = warm golden light; the moon is cool and dim.
  const warmth = THREE.MathUtils.smoothstep(elevation, 2, 30);
  // Valheim's sunlight stays golden even at noon.
  const sunColor = new THREE.Color(1, 0.62 + 0.3 * warmth, 0.38 + 0.42 * warmth);
  const moonColor = new THREE.Color(0.55, 0.65, 1);
  lightDir.copy(daylight > 0.05 ? sunDir : moonDir);
  lightColor.copy(moonColor).multiplyScalar((0.6 + 0.25 * Math.min(nightVision(), 1)) * night).lerp(sunColor, daylight);
  sun.color.copy(lightColor);
  // Strong sun against modest sky fill, so shadows and light beams have real contrast.
  // Under overcast the sun is a bright patch in the grey: little direct light, flatter shade.
  sun.intensity = (daylight > 0.05 ? 8 * daylight : 2.2) * (1 - 0.82 * overcast);
  // The blue fill also covers twilight: after sunset neither sun nor moon lights the shade, and under a canopy the
  // ground went black (exposure can't lift black).
  const twilight = 1 - THREE.MathUtils.smoothstep(elevation, -6, 3);
  darkHours = Math.max(night, twilight);
  const nv = Math.min(nightVision(), 1);
  nightFill.intensity = 1.4 * night + nv * (2.2 * darkHours - 1.4 * night);
  applyNightVision();
  (stars.material as THREE.PointsMaterial).opacity = night;
  baseExposure = settings.exposure * (1 + 1.6 * night);
  renderer.toneMappingExposure = baseExposure * eyeAdapt;

  water.uniforms.uSunDir.value.copy(lightDir);
  const luma = lightColor.r * 0.2126 + lightColor.g * 0.7152 + lightColor.b * 0.0722;
  scatterSun.copy(lightColor).lerp(new THREE.Color(luma, luma, luma), overcast).multiplyScalar(1 - 0.75 * overcast);
  water.uniforms.uSunColor.value.copy(scatterSun);
  // The haze's violet seam and orange scatter fade with the sun under overcast, like the sky's.
  post.atmosphere.uHueSplit.value = sky.uniforms.uHueSplit.value * (1 - 0.85 * overcast);
  post.atmosphere.uShaftStrength.value = shaftStrength.value * daylight * (1 - overcast);
  post.atmosphere.uVolumetric.value = volumetric.value * daylight * (1 - 0.85 * overcast);
  // Night sky: moon and Milky Way (washed out by a bright moon), aurora on clear nights.
  const nightSky = 1 - THREE.MathUtils.smoothstep(elevation, -10, -2);
  sky.uniforms.uNight.value = nightSky;
  sky.uniforms.uMoonDir.value.copy(moonDir);
  sky.uniforms.uMoonPhase.value = settings.moonPhase;
  const moonFull = 1 - Math.abs(settings.moonPhase * 2 - 1);
  sky.uniforms.uMilkyWay.value = (1 - 0.6 * moonFull) * (1 - overcast);
  sky.uniforms.uAurora.value = settings.aurora * (1 - THREE.MathUtils.smoothstep(overcast, 0.2, 0.6));

  cubeCamera.update(renderer, skyScene);
  envTarget?.dispose();
  // The ambient light sees land below the horizon; the cube (haze, water) keeps the painted sky.
  sky.probeMesh.material = sky.lightingMaterial;
  envTarget = pmrem.fromScene(skyScene);
  sky.probeMesh.material = sky.probeMaterial;
  scene.environment = envTarget.texture;
  // Modest sky fill: shadows stay deep enough for light and shade to model the scene.
  scene.environmentIntensity = 0.34 * (1 + 0.6 * overcast);
}
const shaftStrength = { value: post.atmosphere.uShaftStrength.value };
persist.bind('time', settings, ['time', 'sunRotation', 'daySpeed', 'clouds', 'exposure', 'nightVision', 'nightVisionOn', 'fogDensity', 'whimsy', 'pollen', 'groundFog', 'groundFogHeight', 'groundFogPatchy', 'weather', 'aurora', 'moonPhase']);
weather.mode = settings.weather;
applyNightVision();
post.setWhimsy(settings.whimsy);
persist.bind('tint', post.atmosphere.uTintStrength, ['value']);
// Valheim's hue split (blue -> violet-pink -> orange) in the sky, the haze and the scattered sunlight.
const hueSplit = { value: 1 };
persist.bind('hueSplit', hueSplit, ['value']);
persist.bind('shadeTint', post.atmosphere.uShadeTint, ['value']);
const applyHueSplit = () => {
  sky.uniforms.uHueSplit.value = hueSplit.value;
  updateSun();
};
persist.bind('cloudShadow', post.atmosphere.uCloudShadow, ['value']);
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
persist.bind('depth', post.grade.uDepth, ['value']);
persist.bind('colorRichness', post.grade.uColorRichness, ['value']);
persist.bind('warmth', post.grade.uWarmth, ['value']);
persist.bind('vignette', post.grade.uVignette, ['value']);
post.atmosphere.uFogDensity.value = settings.fogDensity;
updateSun();

// --- Controls panel
const gui = new GUI({ title: 'Meadows' });
gui.add(settings, 'whimsy', 0, 1.5, 0.01).name('✨ whimsy').onChange((v: number) => post.setWhimsy(v));
gui.add(settings, 'pollen').name('pollen & seed fluff');

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
timeGui
  .add(settings, 'weather', { 'Auto (changes by itself)': 'auto', Clear: 'clear', Fair: 'fair', Cloudy: 'cloudy', Overcast: 'overcast', Rain: 'rain', 'Manual (cloud slider)': 'manual' })
  .name('weather')
  .onChange((m: WeatherMode) => weather.pick(m));
timeGui.add(settings, 'clouds', 0, 1, 0.01).name('clouds (manual weather)').onChange(updateSun);
timeGui.add(settings, 'aurora', 0, 1.5, 0.01).name('northern lights').onChange(updateSun);
timeGui.add(settings, 'moonPhase', 0, 1, 0.01).name('moon phase (0.5 full)').onChange(updateSun);
timeGui.add(post.atmosphere.uCloudShadow, 'value', 0, 1, 0.01).name('cloud shadows');
timeGui.add(settings, 'fogDensity', 0, 0.003, 0.0001).name('haze').onChange((v: number) => (post.atmosphere.uFogDensity.value = v));
/** Ground fog from the panel, plus the weather's morning mist and the murk of rain. */
const applyGroundFog = () => {
  post.atmosphere.uGroundFog.value = settings.groundFog + weather.mist * 0.9;
  post.atmosphere.uGroundFogHeight.value = settings.groundFogHeight + weather.mist * 5;
  post.atmosphere.uGroundFogPatchy.value = settings.groundFogPatchy;
};
applyGroundFog();
timeGui.add(settings, 'groundFog', 0, 2, 0.01).name('ground fog').onChange(applyGroundFog);
timeGui.add(settings, 'groundFogHeight', 0.5, 20, 0.1).name('ground fog height (m)').onChange(applyGroundFog);
timeGui.add(settings, 'groundFogPatchy', 0, 1, 0.01).name('ground fog patchiness').onChange(applyGroundFog);
timeGui.add(post.atmosphere.uTintStrength, 'value', 0, 1, 0.01).name('cyan / gold tint');
timeGui.add(hueSplit, 'value', 0, 2, 0.01).name('hue split (violet, orange)').onChange(applyHueSplit);
applyHueSplit();
timeGui.add(post.atmosphere.uShadeTint, 'value', 0, 1.5, 0.01).name('teal shade');
timeGui.add(wind.uWindStrength, 'value', 0, 3, 0.01).name('wind');

const torchGui = gui.addFolder('Torch');
torchGui.add(torch, 'on').name('lit (T)').listen();
torchGui.add(torch, 'brightness', 0, 3, 0.05);
torchGui.add(torch, 'embersOn').name('embers');
torchGui.add(torch, 'smokeOn').name('smoke');
torchGui.close();

const postGui = gui.addFolder('Effects');
postGui.add(settings, 'exposure', 0.1, 2, 0.01).onChange(updateSun);
postGui.add(settings, 'nightVisionOn').name('see in the dark').onChange(updateSun);
postGui.add(settings, 'nightVision', 0, 2, 0.05).name('see in the dark: strength').onChange(updateSun);
postGui.add(volumetric, 'value', 0, 3, 0.01).name('volumetric light').onChange(updateSun);
postGui.add(shaftStrength, 'value', 0, 3, 0.01).name('sun glare shafts').onChange(updateSun);
postGui.add(post.atmosphere.uAOStrength, 'value', 0, 1, 0.01).name('ambient occlusion');
postGui.add(post.ao.uRadius, 'value', 0.2, 5, 0.05).name('AO radius');
postGui.add(post.ao.uIntensity, 'value', 0, 4, 0.05).name('AO intensity');
postGui.add(post.bloom, 'strength', 0, 2, 0.01).name('bloom');
postGui.add(post.bloom, 'threshold', 0, 8, 0.05).name('bloom threshold');
postGui.add(post.grade.uSaturation, 'value', 0, 2, 0.01).name('saturation');
postGui.add(post.grade.uContrast, 'value', 0.5, 1.5, 0.01).name('contrast');
postGui.add(post.grade.uDepth, 'value', 0, 1, 0.01).name('depth (light/shade curve)');
postGui.add(post.grade.uColorRichness, 'value', 0, 2, 0.01).name('color richness');
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
  fps.setVisible(display.showFps);
  if (post.taa.enabled !== display.taa) post.taa.reset();
  post.taa.enabled = display.taa;
  useCoverage(!display.taa);
}

/**
 * Alpha-to-coverage (soft cutout edges under MSAA) writes partial alpha at leaf and frond edges, which the TAA would
 * read as wind motion (see MOTION_SCALE in wind.ts). While TAA is on, those materials use a plain alpha test instead
 * (the TAA smooths their edges); each remembers that it had coverage, so switching TAA off restores it.
 */
function useCoverage(on: boolean) {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.alphaToCoverage) m.userData.coverage = true;
      if (!m.userData.coverage || m.alphaToCoverage === on) continue;
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
  });
}
/**
 * Performance switches on top of the preset: each costly effect can be turned off or scaled. Costs in the labels are
 * what each saved at 1280×720 on medium (`scripts/measure/perf.js`); they vary with the view.
 */
const perf = {
  clouds: true,
  beams: true,
  ao: true,
  bloom: true,
  glow: true,
  reflections: true,
  farShadows: true,
  motionVectors: true,
  life: true,
  treeDetail: 1,
  grass: 1,
  grassReach: 1,
  cover: 1,
  rain: 1,
};
persist.bind('perf', perf, Object.keys(perf) as (keyof typeof perf)[]);
/** Folds the performance switches into the active preset's values (which the scene modules read live). */
function applyPerf() {
  if (!perf.clouds) quality.cloudSteps = 0;
  if (!perf.ao) quality.aoScale = 0;
  if (!perf.glow) quality.glow = false;
  if (!perf.reflections) quality.waterReflectionSteps = 0;
  if (!perf.farShadows) quality.farShadowExtent = 0;
  if (!perf.life) quality.motes = 0;
  quality.treeDetail *= perf.treeDetail;
  quality.grassDensity *= perf.grass;
  quality.grassRadius *= perf.grassReach;
  quality.coverDensity *= perf.cover;
  post.setEffects(perf.beams, perf.bloom, perf.motionVectors);
  for (const g of [world.life.group, world.deer.group, world.pondLife.group]) g.visible = perf.life;
}
/** Switches the graphics preset; `keepScale` leaves the render scale alone (on load, where it was persisted). */
function applyQuality(keepScale = false) {
  setQuality(display.quality);
  applyPerf();
  if (!keepScale) display.renderScale = quality.renderScale;
  sunShadows.applyQuality();
  post.setQuality(quality.volumetricSteps, quality.aoScale, quality.glow, quality.cloudSteps);
  sky.setVolumetricClouds(quality.cloudSteps > 0);
  water.setReflectionSteps(quality.waterReflectionSteps);
  qualityInfo.text = QUALITY_PRESETS[display.quality].label;
  applyDisplay();
  world.update(camera, true);
  displayGui.controllersRecursive().forEach((c) => c.updateDisplay());
}
const displayGui = gui.addFolder('Display');
const qualityInfo = { text: QUALITY_PRESETS[display.quality].label };
displayGui.add(display, 'quality', { Low: 'low', Medium: 'medium', High: 'high', Ultra: 'ultra' }).name('graphics quality').onChange(() => applyQuality());
displayGui.add(qualityInfo, 'text').name('trade-off').disable();
displayGui.add(display, 'showFps').name('FPS counter (P)').listen().onChange(applyDisplay);
displayGui.add(display, 'taa').name('temporal AA').onChange(applyDisplay);
displayGui.add(display, 'maxWidth', 640, 3840, 10).name('max width (px)').onChange(applyDisplay);
displayGui.add(display, 'maxHeight', 360, 2160, 10).name('max height (px)').onChange(applyDisplay);
displayGui.add(display, 'renderScale', 0.25, 1.5, 0.05).name('render scale').onChange(applyDisplay);
displayGui.add(display, 'fov', 30, 100, 1).name('field of view').onChange(applyDisplay);
displayGui.add(display, 'showMinimap').name('minimap (M)').listen().onChange(applyDisplay);
displayGui.add(display, 'minimapSize', 120, 480, 10).name('minimap size').onChange(applyDisplay);
displayGui.close();

const perfGui = gui.addFolder('Performance');
const perfNote = { text: 'ms per frame (16.7 = 60 fps)' };
perfGui.add(perfNote, 'text').name('note').disable();
const perfChange = () => applyQuality(true);
perfGui.add(perf, 'clouds').name('volumetric clouds (~1 ms)').onChange(perfChange);
perfGui.add(perf, 'beams').name('sunbeams & god rays (~0.5 ms)').onChange(perfChange);
perfGui.add(perf, 'ao').name('ambient occlusion (~0.4 ms)').onChange(perfChange);
perfGui.add(perf, 'bloom').name('bloom (~0.4 ms)').onChange(perfChange);
perfGui.add(perf, 'glow').name('whimsy glow (~0.5 ms)').onChange(perfChange);
perfGui.add(perf, 'reflections').name('water reflections (~0.3 ms)').onChange(perfChange);
perfGui.add(perf, 'farShadows').name('distant shadows (~1 ms)').onChange(perfChange);
perfGui.add(perf, 'motionVectors').name('sharp movers in TAA (~0.1 ms)').onChange(perfChange);
perfGui.add(perf, 'life').name('animals & motes (~0.4 ms)').onChange(perfChange);
perfGui.add(perf, 'treeDetail', 0.4, 1.5, 0.05).name('tree detail (trees 6-8 ms)').onChange(perfChange);
perfGui.add(perf, 'grass', 0.2, 1.5, 0.05).name('grass density (1.5-3 ms)').onChange(perfChange);
perfGui.add(perf, 'grassReach', 0.4, 1.5, 0.05).name('grass reach').onChange(perfChange);
perfGui.add(perf, 'cover', 0.2, 1.5, 0.05).name('ferns & flowers (0.4-2.5 ms)').onChange(perfChange);
perfGui.add(perf, 'rain', 0, 1, 0.05).name('raindrops (under 0.3 ms, in rain)');
perfGui.close();

// --- Minimap: click to travel there.
const minimap = new Minimap(display.minimapSize);
stage.appendChild(minimap.element);
const fps = new FpsMeter();
stage.appendChild(fps.element);
minimap.setWorld(world.fns);
minimap.onNavigate = (x, z) => {
  const ground = Math.max(world.height(x, z), 0);
  const altitude = player.position.y - Math.max(world.height(player.position.x, player.position.z), 0);
  player.position.set(x, ground + (movement.mode === 'fly' ? Math.max(altitude, 10) : EYE_HEIGHT), z);
  verticalSpeed = 0;
  snapView();
  world.update(camera, true);
  post.taa.reset();
  sunShadows.refresh();
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
  if (e.code === 'KeyP') {
    display.showFps = !display.showFps;
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
      water.setPonds(world.fns.ponds);
      water.setRivers(world.fns.riverCenters);
      setRockPonds(world.fns.ponds);
      builtParams = JSON.stringify(params);
      scene.add(world.group);
      for (const g of [world.life.group, world.deer.group, world.pondLife.group]) g.visible = perf.life;
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
if (query.has('weather')) {
  weather.mode = query.get('weather') as WeatherMode;
  // Jump straight to it (no minute-long build-up), for screenshots.
  const q = weather.mode === 'auto' || weather.mode === 'manual' ? 'fair' : weather.mode;
  weather.clouds = { clear: 0.12, fair: 0.38, cloudy: 0.62, overcast: 0.85, rain: 0.95 }[q];
  weather.overcast = { clear: 0, fair: 0, cloudy: 0.25, overcast: 0.7, rain: 1 }[q];
  weather.rain = weather.wetness = q === 'rain' ? 1 : 0;
  updateSun();
}
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
  if (['KeyT', 'KeyF', 'KeyM', 'KeyV', 'KeyH', 'KeyP'].includes(e.code)) persist.save();
});
window.addEventListener('pagehide', () => persist.save());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist.save());

function resetToDefaults() {
  persist.reset();
  applyQuality(true);
  post.atmosphere.uFogDensity.value = settings.fogDensity;
  post.setWhimsy(settings.whimsy);
  applyGroundFog();
  controls.pointerSpeed = movement.sensitivity;
  verticalSpeed = 0;
  updateSun();
  applyDisplay();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  if (JSON.stringify(params) !== builtParams) regenerate();
}
gui.add({ reset: resetToDefaults }, 'reset').name('↺ Reset to defaults');

/**
 * How much forest canopy surrounds a point (0..1): the forest mask averaged over a small patch, counting only ground
 * trees grow on (the same height and river rules as `trees.ts`). The mask alone runs on over beaches and water next
 * to a forest, where the air is open and sunlit; treating that as deep forest drowned the view in forest haze.
 */
function canopyAround(x: number, z: number) {
  const f = world.fns;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI * 2, r = i === 8 ? 0 : 12;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const treeable = THREE.MathUtils.smoothstep(f.height(px, pz), 2.5, 4.5) * (1 - THREE.MathUtils.smoothstep(f.river(px, pz), 0.1, 0.3));
    sum += f.forest(px, pz) * treeable;
  }
  return sum / 9;
}

const lookDir = new THREE.Vector3();
const timer = new THREE.Timer();
let sinceSunUpdate = 0;
let weatherDrift = 0, sinceWeatherLight = 0, sinceAuroraCube = 0;
renderer.setAnimationLoop((now) => {
  fps.frame(now);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const motion = updateCamera(dt);
  updateView(dt);
  const torchAim = updateCharacter(dt, motion);

  // Advance the clock; re-lighting rebuilds the sky probes, so do it a few times a second, not every frame.
  if (settings.daySpeed > 0) {
    // Golden hours linger: the clock runs at under half speed while the sun is low (and in the first glow of dusk),
    // full speed through midday and the night.
    const elevation = sunPath(settings.time).elevation;
    const pace = 0.42 + 0.58 * Math.max(THREE.MathUtils.smoothstep(elevation, 14, 26), 1 - THREE.MathUtils.smoothstep(elevation, -8, -3));
    const before = settings.time;
    settings.time = (settings.time + (settings.daySpeed / 60) * dt * pace) % 24;
    // A new night: the moon moves on through its phases.
    if (settings.time < before) settings.moonPhase = (settings.moonPhase + 1 / 29.5) % 1;
    sinceSunUpdate += dt;
    if (sinceSunUpdate > 0.2) {
      sinceSunUpdate = 0;
      timeCtrl.updateDisplay();
      updateSun();
    }
  }

  // Weather: the sky, light and haze follow it; re-light a couple of times a second while it changes.
  const elevationNow = sunPath(settings.time).elevation;
  const prevOvercast = weather.overcast, prevClouds = weather.clouds;
  weather.update(dt, settings.clouds, settings.time, elevationNow);
  weatherDrift += Math.abs(weather.overcast - prevOvercast) + Math.abs(weather.clouds - prevClouds);
  sinceWeatherLight += dt;
  if (weatherDrift > 0.01 && sinceWeatherLight > 0.5) {
    weatherDrift = 0;
    sinceWeatherLight = 0;
    updateSun();
  }
  post.atmosphere.uRainbow.value = weather.rainbow;
  weatherUniforms.uWeatherTime.value = timer.getElapsed() % 1000;
  // Rain thickens the air; overcast a little.
  const fog = settings.fogDensity * (1 + 0.5 * weather.overcast) + weather.rain * 0.0011;
  post.atmosphere.uFogDensity.value = fog;
  applyGroundFog();
  rain.update(timer.getElapsed() % 10000, camera, weather.rain, perf.rain, sky.uniforms.uHorizon.value, lightDir, scatterSun);
  // The aurora moves; refresh the reflection cube now and then so the sea mirrors it.
  if (sky.uniforms.uNight.value > 0 && sky.uniforms.uAurora.value > 0) {
    sinceAuroraCube += dt;
    if (sinceAuroraCube > 0.3) {
      sinceAuroraCube = 0;
      cubeCamera.update(renderer, skyScene);
    }
  }

  water.uniforms.uTime.value = timer.getElapsed();
  water.uniforms.uHaze.value = fog;
  water.uniforms.uGlitter.value = 0.5 + settings.whimsy;
  sky.uniforms.uTime.value = timer.getElapsed();
  // High cirrus: more with whimsy, none when the clouds slider clears the sky.
  sky.uniforms.uWisps.value = (0.5 + settings.whimsy * 0.6) * THREE.MathUtils.smoothstep(weather.clouds, 0, 0.2) * (1 - weather.overcast);
  // Clouds drift with the wind and stay put over the land as you move, so their shadows line up with them.
  const t = timer.getElapsed();
  sky.uniforms.uCloudOffset.value.set(t * 0.004 + (camera.position.x * 0.9) / CLOUD_HEIGHT, t * 0.0015 + (camera.position.z * 0.9) / CLOUD_HEIGHT);
  post.atmosphere.uCloudOffset.value.copy(sky.uniforms.uCloudOffset.value);
  post.atmosphere.uClouds.value = weather.clouds;
  post.atmosphere.uTime.value = timer.getElapsed();
  post.atmosphere.uGroundY.value = Math.max(world.height(camera.position.x, camera.position.z), 0);
  wind.uPrevTime.value = wind.uTime.value;
  wind.uTime.value = timer.getElapsed();
  camera.updateMatrixWorld();
  world.update(camera);

  // Inside a forest the haze thickens; ease toward it so walking in and out doesn't pop.
  const altitude = camera.position.y - world.height(camera.position.x, camera.position.z);
  const forestHere = canopyAround(camera.position.x, camera.position.z) * (1 - THREE.MathUtils.smoothstep(altitude, 5, 40));
  post.atmosphere.uForest.value += (forestHere - post.atmosphere.uForest.value) * Math.min(dt * 1.5, 1);
  world.life.update(timer.getElapsed(), camera, daylight, post.atmosphere.uForest.value);
  world.deer.update(timer.getElapsed(), player.position);
  world.pondLife.update(timer.getElapsed(), player.position, daylight);

  // Eye adaptation: looking into the sun stops the view down a little, so it glows instead of blinding
  // (under a canopy most of it is hidden, so adapt less there).
  const intoSun = THREE.MathUtils.smoothstep(camera.getWorldDirection(lookDir).dot(lightDir), 0.7, 0.97) * daylight;
  // Under a dense canopy the eye opens up, so forests read as shaded rather than murky.
  const forestOpen = 1 + 0.55 * post.atmosphere.uForest.value * daylight;
  // Dark views open up: the metered mid-tone (at the base exposure, so this doesn't chase its own output) is pulled
  // toward a floor, partly (a night should still look like night), up to a limit set by `nightVision`.
  // The meter is smoothed over ~1.5 s, so glancing at a bright gap or a dark trunk doesn't pump the exposure.
  const reading = Math.log2(post.luminance.average);
  if (Number.isFinite(reading)) meteredLog = Number.isFinite(meteredLog) ? meteredLog + (reading - meteredLog) * Math.min(dt / 1.5, 1) : reading;
  const metered = 2 ** meteredLog * baseExposure;
  const maxLift = 1 + 3.5 * nightVision() * darkHours;
  const darkLift = Number.isFinite(metered) && metered > 0 ? THREE.MathUtils.clamp(Math.pow(0.05 / metered, 0.6), 1, maxLift) : 1;
  const adaptTarget = (1 - 0.22 * intoSun * (1 - 0.6 * post.atmosphere.uForest.value)) * forestOpen * darkLift;
  // Stopping down is quick; opening up in the dark takes a couple of seconds, like an eye.
  eyeAdapt += (adaptTarget - eyeAdapt) * Math.min(dt * (adaptTarget < eyeAdapt ? 1.5 : 0.8), 1);
  renderer.toneMappingExposure = baseExposure * eyeAdapt;

  // Keep the shadow frustum centered on the viewer.
  sunShadows.update(camera.position, lightDir);
  stars.position.copy(camera.position);

  const pixelsPerMeter = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  torch.update(camera, timer.getElapsed(), dt, pixelsPerMeter, torchAim);
  // Without pollen the motes fade out by day; the fireflies still come out at night.
  motes.update(timer.getElapsed(), camera, lightDir, daylight, Math.min(settings.whimsy, 1.2) * (settings.pollen ? 1 : 1 - daylight), pixelsPerMeter);
  fluff.update(timer.getElapsed() % 10000, dt, camera, lightDir, scatterSun, sky.uniforms.uHorizon.value, daylight,
    1 - world.fns.forest(camera.position.x, camera.position.z), (1 - weather.rain) * (1 - 0.6 * weather.overcast) * (settings.pollen ? 1 : 0),
    wind.uWindStrength.value, pixelsPerMeter);
  splashes.update(timer.getElapsed() % 10000, camera, weather.rain, perf.rain, sky.uniforms.uHorizon.value, pixelsPerMeter);
  minimap.update(camera, camera.getWorldDirection(lookDir));
  post.atmosphere.uTorchPos.value.copy(torch.flameWorld);
  post.atmosphere.uTorchColor.value.copy(torch.flameColor);

  sunLight.uSunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
  sunLight.uSunColor.value.copy(scatterSun);
  // Chunks streamed in since last frame bring fresh alpha-to-coverage materials; switch them before they draw
  // (a scene sweep costs ~0.05 ms).
  if (display.taa) useCoverage(false);
  post.render(lightDir, scatterSun);
});

// Apply the preset with the performance switches, then fill grass and ground cover before the first frame so the
// opening view isn't bare.
applyQuality(true);
snapView();
world.update(camera, true);

// Debug handle for automated screenshots.
Object.assign(window, {
  __app: { camera, scene, renderer, settings, updateSun, sky, wind, cubeTarget, skyScene, post, params, regenerate, display, applyDisplay, movement, torch, persist, player, character, snapView, lookAt, groundUniforms, resetToDefaults, applyQuality, quality, perf, weather, addRipple, fluff, fps, sunShadows, get world() { return world; } },
});
