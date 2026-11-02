import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import GUI from 'lil-gui';
import { createWater, addRipple } from './water';
import { wind, sunLight, windControl, WindDrift } from './wind';
import { VIBES, type VibeName } from './vibes';
import { Tour } from './tour';
import { Demo, type DemoHost } from './demo';
import { sprayBowControl } from './waterfall';
import { Trample, type Walker } from './trample';
import { PhotoMode, PlayLens, fovFor, lensSettings, photoSettings, savePhoto } from './photo';
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
import { Seasons, SEASONS, type Season } from './season';
import { CloudPass } from './clouds';
import { Motes } from './motes';
import { loadPlants } from './plants';
import { QUALITY_PRESETS, quality, setQuality, type QualityLevel } from './quality';
import { FpsMeter } from './fps';
import { SunShadows, seeFarCasters } from './cascades';
import { Weather, weatherUniforms, type WeatherKind, type WeatherMode } from './weather';
import { Rain, Snow, Splashes } from './rain';
import { Soundscape } from './audio';
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
   * leaves reproject with their wind motion, so they stay sharp. Off by default: in motion it still smears and
   * ghosts (the user's call, 2026-11-01); grass edges fall back to alpha-to-coverage MSAA. */
  taa: false,
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
const movers = () => [characterRoot, world.deer.group, world.life.group, world.pondLife.group, world.coast.group];
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
const snow = new Snow();
snow.setSceneDepth(post.sceneDepth);
overlay.add(snow.points);
// Splashes where the drops land (follows regenerate through the closure).
const splashes = new Splashes((x, z) => world.height(x, z));
// Footprints in snow and sand, and grass bent aside where the player and the deer walk.
const trample = new Trample();
const walkers: Walker[] = [];
const coastLight = new THREE.Color();
// Dandelion and thistle down drifting over the meadows on fine days.
const fluff = new SeedFluff();
fluff.setSceneDepth(post.sceneDepth);
overlay.add(fluff.points);
splashes.setSceneDepth(post.sceneDepth);
overlay.add(splashes.points);
// Rainbows in the waterfalls' spray (rebuilt with each world).
world.waterfalls.setSceneDepth(post.sceneDepth);
overlay.add(world.waterfalls.overlay);
// Spray from the whale, the gulls' dives and the surf of a breach.
world.coast.setSceneDepth(post.sceneDepth);
overlay.add(world.coast.overlay);
const weather = new Weather();
// The time of year (season.ts). `snap`: at once, snow included (on load and for shots), instead of washing over.
const seasons = new Seasons();
function applySeason(snap = false) {
  seasons.season = settings.season;
  world.setSeason(seasons.season);
  if (snap) {
    seasons.update(0, true);
    weather.heldSnow = seasons.heldSnow;
    weather.snowCover = Math.max(weather.snowCover, seasons.heldSnow);
  }
}

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
  /** The world's color mood (vibes.ts); 'whimsical' is the tuned cyan-and-gold look. */
  vibe: 'whimsical' as VibeName,
  /** How far the vibe goes: 0 = the whimsical look, 1 = as designed, 1.5 = pushed. */
  vibeStrength: 1,
  /** The time of year (season.ts): spring blossom, summer, autumn colors, winter snow and bare trees. */
  season: 'summer' as Season,
  /** Valheim's dreamy side: two-tone haze, stronger beams, lens flares, soft glow, floating motes and fireflies. */
  whimsy: 0.9,
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
  // Moonlight, by phase: a full moon lights the night silver-blue, a thin crescent barely at all.
  const moonFull = 1 - Math.abs(settings.moonPhase * 2 - 1);
  const moonBright = 0.4 + 0.75 * moonFull;
  const nightK = 1 - THREE.MathUtils.smoothstep(elevation, -9, -1);
  sky.uniforms.uMoonLight.value = nightK * moonBright * (1 - 0.6 * overcast);
  sky.update(sunDir, elevation, settings.time >= 13 || settings.time < 1, weather.clouds, overcast);
  sky.uniforms.uSunDisc.value = 12 * (1 - overcast);

  daylight = THREE.MathUtils.smoothstep(elevation, -4, 6);
  const night = 1 - THREE.MathUtils.smoothstep(elevation, -9, -1);
  // Low sun = warm golden light; the moon is cool and dim.
  const warmth = THREE.MathUtils.smoothstep(elevation, 2, 30);
  // Valheim's sunlight stays golden even at noon.
  const sunColor = new THREE.Color(1, 0.62 + 0.3 * warmth, 0.38 + 0.42 * warmth);
  // Silver-blue moonlight.
  const moonColor = new THREE.Color(0.62, 0.73, 1).multiplyScalar(moonBright);
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
  // The water's light carries the light's strength as well as its color: at night the moon is ~4x dimmer than the
  // sun while exposure is ~7x higher, so a color-only light made the shallows glow brighter than at noon.
  water.uniforms.uSunColor.value.copy(scatterSun).multiplyScalar(Math.min(1, sun.intensity / 8 + 0.15 * daylight));
  // The haze's violet seam and orange scatter fade with the sun under overcast, like the sky's.
  post.atmosphere.uHueSplit.value = sky.uniforms.uHueSplit.value * (1 - 0.85 * overcast) * (1 - nightK);
  post.atmosphere.uShaftStrength.value = shaftStrength.value * daylight * (1 - overcast);
  post.atmosphere.uVolumetric.value = volumetric.value * daylight * (1 - 0.85 * overcast);
  post.atmosphere.uFlareOn.value = daylight;
  post.atmosphere.uScotopic.value = nightK;
  post.grade.uNight.value = nightK;
  // Night sky: moon and Milky Way (washed out by a bright moon), aurora on clear nights.
  const nightSky = 1 - THREE.MathUtils.smoothstep(elevation, -10, -2);
  sky.uniforms.uNight.value = nightSky;
  sky.uniforms.uMoonDir.value.copy(moonDir);
  sky.uniforms.uMoonPhase.value = settings.moonPhase;
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
persist.bind('time', settings, ['time', 'sunRotation', 'daySpeed', 'clouds', 'exposure', 'nightVision', 'nightVisionOn', 'fogDensity', 'whimsy', 'pollen', 'groundFog', 'groundFogHeight', 'groundFogPatchy', 'weather', 'aurora', 'moonPhase', 'vibe', 'vibeStrength', 'season']);
weather.mode = settings.weather;
applyNightVision();
post.setWhimsy(settings.whimsy);
persist.bind('tint', post.atmosphere.uTintStrength, ['value']);
// Valheim's hue split (blue -> violet-pink -> orange) in the sky, the haze and the scattered sunlight.
const hueSplit = { value: 1.4 };
persist.bind('hueSplit', hueSplit, ['value']);
persist.bind('shadeTint', post.atmosphere.uShadeTint, ['value']);
const applyHueSplit = () => {
  sky.uniforms.uHueSplit.value = hueSplit.value;
  updateSun();
};
persist.bind('cloudShadow', post.atmosphere.uCloudShadow, ['value']);
persist.bind('wind', windControl, ['value', 'changing']);
persist.bind('lens', lensSettings, ['on', 'focal', 'fStop', 'dreamy', 'setsFov']);
const windDrift = new WindDrift();
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
const vibeOptions = Object.fromEntries(Object.entries(VIBES).map(([key, v]) => [v.label, key]));
const applyVibe = () => {
  if (!(settings.vibe in VIBES)) settings.vibe = 'whimsical';
  post.setVibe(settings.vibe);
  post.vibe.uStrength.value = settings.vibeStrength;
};
gui.add(settings, 'vibe', vibeOptions).name('🎨 vibe').onChange(applyVibe);
gui.add(settings, 'vibeStrength', 0, 1.5, 0.01).name('vibe strength').onChange(applyVibe);
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
  .add(settings, 'weather', { 'Auto (changes by itself)': 'auto', Clear: 'clear', Fair: 'fair', Cloudy: 'cloudy', Overcast: 'overcast', Rain: 'rain', Snow: 'snow', 'Manual (cloud slider)': 'manual' })
  .name('weather')
  .onChange((m: WeatherMode) => weather.pick(m));
timeGui
  .add(settings, 'season', { '🌸 Spring': 'spring', '☀️ Summer': 'summer', '🍂 Autumn': 'autumn', '❄️ Winter': 'winter' })
  .name('season')
  .onChange(() => applySeason());
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
timeGui.add(windControl, 'value', 0, 3, 0.01).name('wind');
timeGui.add(windControl, 'changing').name('wind changes by itself');
timeGui.add(windControl, 'now', 0, 3.2, 0.01).name('wind now').listen().disable();

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

/** The field of view while playing: the panel's, or the real lens's when it sets the view. */
function playFov() {
  return lensSettings.on && lensSettings.setsFov ? fovFor(lensSettings.focal / 1000) : display.fov;
}

function applyDisplay() {
  const { width, height } = viewSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * display.renderScale);
  renderer.setSize(width, height);
  post.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = playFov(); // (photo mode sets its own each frame)
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
  for (const g of [world.life.group, world.deer.group, world.pondLife.group, world.coast.group]) g.visible = perf.life;
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

// Sound: synthesized ambience, creatures and footsteps (src/audio.ts). Starts on the first click or key press.
const sound = new Soundscape(world.fns);
persist.bind('sound', sound.settings, ['on', 'volume']);
const soundGui = gui.addFolder('Sound');
soundGui.add(sound.settings, 'on').name('sound (N)').listen();
soundGui.add(sound.settings, 'volume', 0, 1, 0.01).name('volume');
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => sound.unlock());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN') sound.settings.on = !sound.settings.on;
});

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
      world.setSeason(seasons.season);
      world.waterfalls.setSceneDepth(post.sceneDepth);
      overlay.add(world.waterfalls.overlay);
      world.coast.setSceneDepth(post.sceneDepth);
      overlay.add(world.coast.overlay);
      sound.setWorld(world.fns);
      water.setPonds(world.fns.ponds);
      water.setRivers(world.fns.riverCenters);
      setRockPonds(world.fns.ponds);
      builtParams = JSON.stringify(params);
      scene.add(world.group);
      for (const g of [world.life.group, world.deer.group, world.pondLife.group, world.coast.group]) g.visible = perf.life;
      player.position.y = Math.max(world.height(player.position.x, player.position.z), 0) + (movement.mode === 'fly' ? 20 : EYE_HEIGHT);
      snapView();
      world.update(camera, true);
      minimap.setWorld(world.fns);
      busy.style.display = 'none';
    }, 30),
  );
}

// --- Cinematic flythrough (K): a tour of the world from dawn to sunset, with no HUD and cinema bars. Everything
// it changes (where you stand, the time of day, fly / walk, the view) is put back when it ends or is stopped.
const cinema = { letterbox: true };
let tour: Tour | null = null;
let beforeTour: { pos: THREE.Vector3; quat: THREE.Quaternion; time: number; daySpeed: number; mode: typeof movement.mode; view: typeof movement.view } | null = null;
let sinceTourLight = 0;
function startTour() {
  if (demo.active) endDemo();
  // Built for the current world (the waypoints come from its coast, oak, river and falls).
  if (!tour || tour.fns !== world.fns) tour = new Tour(world.fns);
  beforeTour = {
    pos: player.position.clone(), quat: player.quaternion.clone(), time: settings.time, daySpeed: settings.daySpeed,
    mode: movement.mode, view: movement.view,
  };
  controls.unlock();
  settings.daySpeed = 0;
  movement.mode = 'fly';
  movement.view = 'first';
  document.body.classList.add('cinema');
  document.body.classList.toggle('letterbox', cinema.letterbox);
  tour.start();
  tour.update(0, player);
  snapView();
  world.update(camera, true);
  post.taa.reset();
  sunShadows.refresh();
}
function endTour() {
  tour?.stop();
  document.body.classList.remove('cinema', 'letterbox');
  if (!beforeTour) return;
  player.position.copy(beforeTour.pos);
  player.quaternion.copy(beforeTour.quat);
  settings.time = beforeTour.time;
  settings.daySpeed = beforeTour.daySpeed;
  movement.mode = beforeTour.mode;
  movement.view = beforeTour.view;
  beforeTour = null;
  timeCtrl.updateDisplay();
  updateSun();
  snapView();
  world.update(camera, true);
  post.taa.reset();
  sunShadows.refresh();
}
const toggleTour = () => (tour?.active ? endTour() : startTour());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyK' && !e.repeat) toggleTour();
});
const cinemaGui = gui.addFolder('Cinematic');
cinemaGui.add({ go: toggleTour }, 'go').name('🎬 flythrough (K)');
cinemaGui.add(cinema, 'letterbox').name('cinema bars');

// --- Photo mode (O): a free, slow camera with a lens (zoom, f-stop, focus), time optionally frozen, Enter saves.
const photo = new PhotoMode(stage);
let beforePhoto: { mode: typeof movement.mode; view: typeof movement.view } | null = null;
let photoPending = false;
function enterPhoto() {
  if (tour?.active) endTour();
  if (demo.active) endDemo();
  beforePhoto = { mode: movement.mode, view: movement.view };
  movement.mode = 'fly';
  movement.view = 'first';
  verticalSpeed = 0;
  photo.enter();
  post.dof.setEnabled(true);
  document.body.classList.add('cinema', 'photo');
}
function exitPhoto() {
  photo.exit();
  post.dof.setEnabled(lensSettings.on);
  timer.setTimescale(1);
  document.body.classList.remove('cinema', 'photo');
  if (beforePhoto) {
    movement.mode = beforePhoto.mode;
    movement.view = beforePhoto.view;
    beforePhoto = null;
  }
  camera.fov = playFov();
  camera.updateProjectionMatrix();
}
const togglePhoto = () => (photo.active ? exitPhoto() : enterPhoto());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyO' && !e.repeat) togglePhoto();
  if (e.code === 'Enter' && photo.active) photoPending = true;
});
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (!photo.active) return;
  e.preventDefault();
  const rect = renderer.domElement.getBoundingClientRect();
  // With the pointer locked, the middle of the frame; otherwise where the click was.
  const locked = document.pointerLockElement === renderer.domElement;
  const u = locked ? 0.5 : (e.clientX - rect.left) / rect.width;
  const v = locked ? 0.5 : 1 - (e.clientY - rect.top) / rect.height;
  photo.focusOn(u, v, post.dof.distanceAt(u, v), camera.far);
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (photo.active) photo.zoom(e.deltaY);
}, { passive: true });
// Leaving the page mid-tour or mid-shot shouldn't save the tour's or photo mode's fly / first-person settings.
window.addEventListener('pagehide', () => {
  if (photo.active) exitPhoto();
  if (tour?.active) endTour();
});
const photoGui = gui.addFolder('Photo mode');
photoGui.add({ go: togglePhoto }, 'go').name('📷 photo mode (O)');
photoGui.add(photoSettings, 'fStop', 1.2, 22, 0.1).name('f-stop (lower = more blur)');
photoGui.add(photoSettings, 'dreamy', 1, 8, 0.1).name('extra dreaminess ×');
photoGui.add(photoSettings, 'freeze').name('freeze time').onChange((v: boolean) => photo.active && timer.setTimescale(v ? 0 : 1));
photoGui.add({ save: () => (photoPending = true) }, 'save').name('💾 save photo (Enter)');

// --- Demo mode (J, or ?demo): a scripted five-minute film of the world (src/demo.ts), with optional captions. It
// drives the clock, weather, season, vibe and lens; everything is put back when it ends, and nothing it sets is saved.
const demoSettings = { captions: true };
persist.bind('demo', demoSettings, ['captions']);
let demoCapture = false;
/** The demo's forest mood brightens the motes (spores and pollen in the light) by this much. */
let demoMotes = 1;
let beforeDemo: {
  pos: THREE.Vector3; quat: THREE.Quaternion; mode: typeof movement.mode; view: typeof movement.view; sound: boolean;
  settings: Pick<typeof settings, 'time' | 'daySpeed' | 'season' | 'vibe' | 'aurora' | 'groundFog' | 'groundFogHeight' | 'groundFogPatchy'>;
  volumetric: number;
  weather: Pick<Weather, 'mode' | 'clouds' | 'overcast' | 'rain' | 'snow' | 'snowCover' | 'wetness' | 'rainbow'>;
  lens: typeof lensSettings;
} | null = null;
/** Puts the weather straight into a state (no build-up). */
function jumpWeather(kind: WeatherKind) {
  weather.mode = kind;
  weather.clouds = { clear: 0.12, fair: 0.38, cloudy: 0.62, overcast: 0.85, rain: 0.95, snow: 0.9 }[kind];
  weather.overcast = { clear: 0, fair: 0, cloudy: 0.25, overcast: 0.7, rain: 1, snow: 0.8 }[kind];
  weather.rain = weather.wetness = kind === 'rain' ? 1 : 0;
  weather.snow = weather.snowCover = kind === 'snow' ? 1 : 0;
  weather.rainbow = 0;
  updateSun();
}
const demoHost: DemoHost = {
  get fns() { return world.fns; },
  sunDir,
  trees: () => world.treeSpots(),
  setTime(hours, relight) {
    settings.time = hours;
    if (relight) updateSun();
  },
  weather(kind, now) {
    if (now) jumpWeather(kind);
    else weather.pick(kind);
  },
  season(s) {
    if (settings.season === s) return;
    settings.season = s;
    applySeason(true);
  },
  vibe(v) {
    if (settings.vibe === v) return;
    settings.vibe = v;
    applyVibe();
  },
  lens(l) {
    lensSettings.on = !!l;
    if (l) Object.assign(lensSettings, { focal: l.focal, fStop: l.fStop, dreamy: 1, setsFov: true });
    applyLens();
  },
  freeze(on) {
    timer.setTimescale(on ? 0 : 1);
  },
  aurora(strength) {
    const v = strength ?? beforeDemo?.settings.aurora ?? settings.aurora;
    if (v === settings.aurora) return;
    settings.aurora = v;
    updateSun();
  },
  whale(at, kind) {
    world.coast.surfaceWhale(camera.position, kind, at);
  },
  capture() {
    demoCapture = true;
  },
  sprayBow(on) {
    sprayBowControl.on = on;
  },
  mood(m) {
    const b = beforeDemo?.settings;
    if (!b) return;
    settings.groundFog = m?.fog ?? b.groundFog;
    settings.groundFogHeight = m?.fogHeight ?? b.groundFogHeight;
    settings.groundFogPatchy = m ? 0.7 : b.groundFogPatchy;
    volumetric.value = m?.light ?? beforeDemo!.volumetric;
    demoMotes = m?.motes ?? 1;
    applyGroundFog();
    updateSun();
  },
  cut() {
    snapView();
    world.update(camera, true);
    post.taa.reset();
    sunShadows.refresh();
  },
};
const demo = new Demo(demoHost, stage);
demo.captions = demoSettings.captions;
function startDemo() {
  if (tour?.active) endTour();
  if (photo.active) exitPhoto();
  beforeDemo = {
    pos: player.position.clone(), quat: player.quaternion.clone(), mode: movement.mode, view: movement.view, sound: sound.settings.on,
    settings: {
      time: settings.time, daySpeed: settings.daySpeed, season: settings.season, vibe: settings.vibe, aurora: settings.aurora,
      groundFog: settings.groundFog, groundFogHeight: settings.groundFogHeight, groundFogPatchy: settings.groundFogPatchy,
    },
    volumetric: volumetric.value,
    weather: {
      mode: weather.mode, clouds: weather.clouds, overcast: weather.overcast, rain: weather.rain, snow: weather.snow,
      snowCover: weather.snowCover, wetness: weather.wetness, rainbow: weather.rainbow,
    },
    lens: { ...lensSettings },
  };
  controls.unlock();
  settings.daySpeed = 0;
  movement.mode = 'fly';
  movement.view = 'first';
  sound.settings.on = true;
  document.body.classList.add('cinema');
  document.body.classList.toggle('letterbox', cinema.letterbox);
  demo.start();
  demo.update(0, player);
  demoHost.cut();
}
function endDemo() {
  demo.stop();
  document.body.classList.remove('cinema', 'letterbox');
  const b = beforeDemo;
  if (!b) return;
  beforeDemo = null;
  player.position.copy(b.pos);
  player.quaternion.copy(b.quat);
  movement.mode = b.mode;
  movement.view = b.view;
  sound.settings.on = b.sound;
  Object.assign(settings, b.settings);
  volumetric.value = b.volumetric;
  demoMotes = 1;
  applyGroundFog();
  Object.assign(lensSettings, b.lens);
  applySeason(true);
  Object.assign(weather, b.weather);
  timer.setTimescale(1);
  applyVibe();
  applyLens();
  timeCtrl.updateDisplay();
  updateSun();
  demoHost.cut();
}
const toggleDemo = () => (demo.active ? endDemo() : startDemo());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyJ' && !e.repeat) toggleDemo();
  if (e.code === 'Escape' && demo.active) endDemo();
});
window.addEventListener('pagehide', () => {
  if (demo.active) endDemo();
});
cinemaGui.add({ go: toggleDemo }, 'go').name('✨ demo film (J)');
cinemaGui.add(demoSettings, 'captions').name('demo captions').onChange((v: boolean) => (demo.captions = v));

// --- The lens while playing: the photo mode's depth of field, with a lens of your choosing (?lens=48,1.2).
const playLens = new PlayLens();
const lensHead = new THREE.Vector3();
function applyLens() {
  if (photo.active) return;
  post.dof.setEnabled(lensSettings.on);
  camera.fov = playFov();
  camera.updateProjectionMatrix();
}
const lensQuery = new URLSearchParams(location.search).get('lens')?.split(',').map(Number);
if (lensQuery) {
  lensSettings.on = true;
  if (lensQuery[0] > 0) lensSettings.focal = lensQuery[0];
  if (lensQuery[1] > 0) lensSettings.fStop = lensQuery[1];
}
applyLens();
const lensGui = gui.addFolder('🔭 Lens (bokeh while playing)');
lensGui.add(lensSettings, 'on').name('real lens').onChange(applyLens);
lensGui.add(lensSettings, 'focal', 14, 200, 1).name('focal length (mm)').onChange(applyLens);
lensGui.add(lensSettings, 'fStop', 1, 22, 0.1).name('f-stop (lower = more blur)');
lensGui.add(lensSettings, 'dreamy', 1, 8, 0.1).name('extra dreaminess ×');
lensGui.add(lensSettings, 'setsFov').name('focal length sets the view').onChange(applyLens);
lensGui.close();

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
  weather.clouds = { clear: 0.12, fair: 0.38, cloudy: 0.62, overcast: 0.85, rain: 0.95, snow: 0.9 }[q];
  weather.overcast = { clear: 0, fair: 0, cloudy: 0.25, overcast: 0.7, rain: 1, snow: 0.8 }[q];
  weather.rain = weather.wetness = q === 'rain' ? 1 : 0;
  weather.snow = weather.snowCover = q === 'snow' ? 1 : 0;
  updateSun();
}
// ?vibe=name picks a color mood (see VIBES in vibes.ts).
if (query.has('vibe')) settings.vibe = query.get('vibe') as VibeName;
// ?season=spring|summer|autumn|winter.
if (SEASONS.includes(query.get('season') as Season)) settings.season = query.get('season') as Season;
applySeason(true);
applyVibe();
// ?wind=strength holds the wind steady at that strength (for screenshots).
if (query.has('wind')) {
  windControl.value = Number(query.get('wind'));
  windControl.changing = false;
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
// ?tour starts the flythrough once the world has settled (for recording); ?demo the demo film (&captions=0 without
// captions).
if (query.has('tour')) setTimeout(startTour, 1500);
if (query.get('captions') === '0') demo.captions = false;
if (query.has('demo')) setTimeout(startDemo, 1500);
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
  if (movement.view !== 'third' || photo.active) return;
  movement.distance = THREE.MathUtils.clamp(movement.distance * Math.exp(e.deltaY * 0.001), 1.5, 10);
}, { passive: true });

const move = new THREE.Vector3();
const soundFeet = new THREE.Vector3();
/** Moves the player's eye; returns whether it stands on the ground and whether a jump started this frame. */
function updateCamera(dt: number) {
  let jumped = false;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const flying = movement.mode === 'fly';
  // Photo mode creeps, for framing.
  const speed = (flying ? movement.flySpeed * (sprint ? movement.flyBoost : 1) : sprint ? movement.runSpeed : movement.walkSpeed) * (photo.active ? 0.25 : 1);
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
    // A long lens narrows the view: step back (and tuck the shoulder offset in) so the character keeps its framing.
    const tele = Math.tan(THREE.MathUtils.degToRad(playFov()) / 2) / Math.tan(THREE.MathUtils.degToRad(display.fov) / 2);
    const reach = movement.distance / tele;
    armDir.set(SHOULDER.x * tele, SHOULDER.y * tele, 1).applyQuaternion(player.quaternion);
    // Shorten the arm where the terrain would come between the camera and the character.
    let length = reach;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * reach;
      probe.copy(pivot).addScaledVector(armDir, t);
      if (probe.y < Math.max(world.height(probe.x, probe.z), 0) + 0.35) {
        length = Math.max(((i - 1) / 8) * reach, 0.6);
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
// (Not while the demo plays: it ends itself on pagehide, before this saves.)
const save = () => !demo.active && persist.save();
gui.onFinishChange(save);
window.addEventListener('keyup', (e) => {
  if (['KeyT', 'KeyF', 'KeyM', 'KeyV', 'KeyH', 'KeyP', 'KeyN'].includes(e.code)) save();
});
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());

function resetToDefaults() {
  persist.reset();
  applyQuality(true);
  post.atmosphere.uFogDensity.value = settings.fogDensity;
  post.setWhimsy(settings.whimsy);
  applyVibe();
  applyGroundFog();
  controls.pointerSpeed = movement.sensitivity;
  verticalSpeed = 0;
  updateSun();
  applyDisplay();
  applyLens();
  applySeason(true);
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
/** Seconds of cloud travel: faster in a gale, slower in a calm. */
let cloudDrift = 0;
let lastFrame = 0;
renderer.setAnimationLoop((now) => {
  fps.frame(now);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  // The camera moves in real time even while photo mode has frozen the world's clock.
  const realDt = Math.min(lastFrame ? (now - lastFrame) / 1000 : 0, 0.1);
  lastFrame = now;
  if (photo.active) {
    timer.setTimescale(photoSettings.freeze ? 0 : 1);
    if (camera.fov !== photo.fov) {
      camera.fov = photo.fov;
      camera.updateProjectionMatrix();
    }
    photo.update(realDt, post.dof.distanceAt, camera.far, renderer.domElement.height, post.dof.uniforms);
  }
  // The flythrough flies the eye and runs the clock; re-light a few times a second as the sun moves.
  const demoing = demo.active;
  const touring = (tour?.active ?? false) || demoing;
  let motion = { grounded: false, jumped: false };
  if (demoing) {
    // Real time: the photo shot freezes the world's clock, not the camera.
    if (!demo.update(realDt, player)) endDemo();
  } else if (touring) {
    const hours = tour!.update(dt, player);
    if (hours === null) endTour();
    else {
      settings.time = hours;
      sinceTourLight += dt;
      if (sinceTourLight > 0.15) {
        sinceTourLight = 0;
        updateSun();
      }
    }
  } else motion = updateCamera(photo.active ? realDt : dt);
  updateView(photo.active || demoing ? realDt : dt);
  if (lensSettings.on && !photo.active) {
    // Third person focuses on the character; first person on whatever is in the middle of the frame.
    let subject: number | null = null;
    if (movement.view === 'third' && character && !touring) {
      camera.updateMatrixWorld();
      lensHead.copy(character.root.position).y += 1.5;
      subject = -lensHead.applyMatrix4(camera.matrixWorldInverse).z;
    }
    playLens.update(demoing ? realDt : dt, subject, post.dof.distanceAt, camera.far, camera.fov, renderer.domElement.height, post.dof.uniforms);
  }
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
  seasons.update(dt);
  weather.heldSnow = seasons.heldSnow;
  weather.update(dt, settings.clouds, settings.time, elevationNow);
  windDrift.update(dt, weather.rain);
  cloudDrift += dt * (0.4 + 0.6 * wind.uWindStrength.value);
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
  const fog = settings.fogDensity * (1 + 0.5 * weather.overcast) + weather.rain * 0.0011 + weather.snow * 0.0014;
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
  sky.uniforms.uCloudOffset.value.set(cloudDrift * 0.004 + (camera.position.x * 0.9) / CLOUD_HEIGHT, cloudDrift * 0.0015 + (camera.position.z * 0.9) / CLOUD_HEIGHT);
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
  coastLight.setRGB(0.85, 0.9, 0.95).multiplyScalar(0.15 + 1.6 * daylight);
  world.coast.update(timer.getElapsed(), dt, camera, daylight, coastLight, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  world.waterfalls.update(timer.getElapsed(), camera.position, daylight, lightDir, 1 - weather.overcast);

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
  motes.update(timer.getElapsed(), camera, lightDir, daylight, Math.min(settings.whimsy, 1.2) * (settings.pollen ? 1 : 1 - daylight) * demoMotes, pixelsPerMeter);
  fluff.update(timer.getElapsed() % 10000, dt, camera, lightDir, scatterSun, sky.uniforms.uHorizon.value, daylight,
    1 - world.fns.forest(camera.position.x, camera.position.z), (1 - weather.rain) * (1 - 0.6 * weather.overcast) * (settings.pollen ? 1 : 0),
    wind.uWindStrength.value, pixelsPerMeter);
  splashes.update(timer.getElapsed() % 10000, camera, weather.rain, perf.rain, sky.uniforms.uHorizon.value, pixelsPerMeter);
  snow.update(timer.getElapsed() % 10000, camera, weather.snow, perf.rain, sky.uniforms.uHorizon.value, pixelsPerMeter);
  soundFeet.copy(player.position).y -= EYE_HEIGHT;
  const footfalls = character ? character.footfalls() : null;
  const onFoot = motion.grounded && movement.mode === 'walk' && !touring;
  {
    walkers.length = 0;
    const yaw = character ? character.root.rotation.y : Math.atan2(-lookDir.x, -lookDir.z);
    if (onFoot) {
      walkers.push({ id: player, x: soundFeet.x, z: soundFeet.z, yaw, speed: 0, size: 1 });
    }
    const near: Walker[] = [];
    world.deer.walkers(near);
    for (const w of near) if (Math.hypot(w.x - soundFeet.x, w.z - soundFeet.z) < 45) walkers.push(w);
    trample.update(dt, walkers, weather.snow);
  }
  sound.update({
    dt, camera, feet: soundFeet, grounded: motion.grounded && movement.mode === 'walk', footfalls,
    hours: settings.time, daylight, rain: weather.rain, snow: weather.snow, snowCover: weather.snowCover,
    wind: wind.uWindStrength.value, torch: torch.on,
  });
  minimap.update(camera, camera.getWorldDirection(lookDir));
  post.atmosphere.uTorchPos.value.copy(torch.flameWorld);
  post.atmosphere.uTorchColor.value.copy(torch.flameColor);

  sunLight.uSunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
  sunLight.uSunColor.value.copy(scatterSun);
  // Chunks streamed in since last frame bring fresh alpha-to-coverage materials; switch them before they draw
  // (a scene sweep costs ~0.05 ms).
  if (display.taa) useCoverage(false);
  trample.render(renderer, soundFeet);
  post.render(lightDir, scatterSun);
  if (photoPending) {
    photoPending = false;
    savePhoto(renderer.domElement);
  }
  if (demoCapture) {
    demoCapture = false;
    demo.develop(renderer.domElement);
  }
});

// Apply the preset with the performance switches, then fill grass and ground cover before the first frame so the
// opening view isn't bare.
applyQuality(true);
snapView();
world.update(camera, true);

// Debug handle for automated screenshots.
Object.assign(window, {
  __app: { demo, startDemo, endDemo, seasons, sunDir, applySeason, trample, sound, windControl, windDrift, applyVibe, startTour, endTour, photo, enterPhoto, exitPhoto, get tour() { return tour; }, camera, scene, renderer, settings, updateSun, sky, wind, cubeTarget, skyScene, post, params, regenerate, display, applyDisplay, movement, torch, persist, player, character, snapView, lookAt, groundUniforms, resetToDefaults, applyQuality, quality, perf, weather, addRipple, fluff, fps, sunShadows, get world() { return world; } },
});
