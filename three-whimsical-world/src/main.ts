import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import GUI from 'lil-gui';
import { createMeadowHeight, createTerrainMesh, createDepthTexture, terrainUniforms } from './terrain';
import { createWater } from './water';
import { Grass, GRASS_RADIUS } from './grass';
import { Trees } from './trees';
import { wind, sunLight } from './wind';
import { createPost } from './post';
import { createFarLand } from './far';
import { createRocks } from './rocks';

const MAX_WATER_DEPTH = 10;

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

const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const shadowExtent = 160;
Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 1200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// --- World
const height = createMeadowHeight();
const terrain = createTerrainMesh(height);
scene.add(terrain);

const water = createWater(cubeTarget.texture, createDepthTexture(height, 512, MAX_WATER_DEPTH), MAX_WATER_DEPTH);
scene.add(water.mesh);

scene.add(createFarLand(height));
scene.add(createRocks(height));

const trees = new Trees(height, renderer);
scene.add(trees.group);

const grass = new Grass(height);
terrainUniforms.uGrassRadius.value = GRASS_RADIUS;
scene.add(grass.group);

const post = createPost(renderer, scene, camera, cubeTarget.texture);

// --- Sun and atmosphere settings (tweakable live)
const settings = {
  elevation: 24,
  azimuth: 200,
  turbidity: 1.5,
  rayleigh: 3,
  exposure: renderer.toneMappingExposure,
  fogDensity: 0.0004,
};
const sunDir = new THREE.Vector3();

function updateSun() {
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - settings.elevation), THREE.MathUtils.degToRad(settings.azimuth));
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(sunDir);
  u.turbidity.value = settings.turbidity;
  u.rayleigh.value = settings.rayleigh;
  u.mieCoefficient.value = 0.0015;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.38;
  u.cloudDensity.value = 0.55;

  water.uniforms.uSunDir.value.copy(sunDir);
  // Lower sun = warmer light.
  const warmth = THREE.MathUtils.smoothstep(settings.elevation, 2, 30);
  sun.color.setRGB(1, 0.72 + 0.25 * warmth, 0.5 + 0.4 * warmth);
  water.uniforms.uSunColor.value.copy(sun.color);

  cubeCamera.update(renderer, skyScene);
  envTarget?.dispose();
  envTarget = pmrem.fromScene(skyScene);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;
}
updateSun();

const gui = new GUI({ title: 'Atmosphere' });
gui.add(settings, 'elevation', 0, 80, 0.5).onChange(updateSun);
gui.add(settings, 'azimuth', 0, 360, 1).onChange(updateSun);
gui.add(settings, 'turbidity', 0, 20, 0.1).onChange(updateSun);
gui.add(settings, 'rayleigh', 0, 4, 0.01).onChange(updateSun);
gui.add(settings, 'exposure', 0.1, 2, 0.01).onChange((v: number) => (renderer.toneMappingExposure = v));
gui.add(settings, 'fogDensity', 0, 0.005, 0.0001).onChange((v: number) => (post.atmosphere.uFogDensity.value = v));
gui.add(wind.uWindStrength, 'value', 0, 3, 0.01).name('wind');
const postGui = gui.addFolder('Post');
postGui.add(post.atmosphere.uShaftStrength, 'value', 0, 3, 0.01).name('light shafts');
postGui.add(post.atmosphere.uAOStrength, 'value', 0, 1, 0.01).name('ambient occlusion');
postGui.add(post.ao.uRadius, 'value', 0.2, 5, 0.05).name('AO radius');
postGui.add(post.ao.uIntensity, 'value', 0, 4, 0.05).name('AO intensity');
postGui.add(post.bloom, 'strength', 0, 2, 0.01).name('bloom');
postGui.add(post.bloom, 'threshold', 0, 8, 0.05).name('bloom threshold');
postGui.add(post.grade.uSaturation, 'value', 0, 2, 0.01).name('saturation');
postGui.add(post.grade.uContrast, 'value', 0.5, 1.5, 0.01).name('contrast');
postGui.add(post.grade.uWarmth, 'value', 0, 0.3, 0.005).name('warmth');
postGui.add(post.grade.uVignette, 'value', 0, 0.8, 0.01).name('vignette');

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

// Start on the meadow looking out to sea. ?cam=x,heightAboveGround,z,tx,ty,tz overrides (handy for screenshots).
const camParam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
if (camParam?.length === 6 && camParam.every(Number.isFinite)) {
  // y is height above the ground here, so shots can't end up underground.
  const [x, y, z] = camParam;
  camera.position.set(x, Math.max(height(x, z), 0) + Math.max(y, 1.7), z);
  camera.lookAt(camParam[3], camParam[4], camParam[5]);
} else {
  camera.position.set(-30, height(-30, 0) + EYE_HEIGHT, 0);
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

  const ground = Math.max(height(camera.position.x, camera.position.z), 0) + EYE_HEIGHT;
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
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  updateCamera(dt);
  water.uniforms.uTime.value = timer.getElapsed();
  wind.uTime.value = timer.getElapsed();
  grass.update(camera.position);
  camera.updateMatrixWorld();
  trees.update(camera);

  // Keep the shadow frustum centered on the viewer.
  sun.target.position.copy(camera.position);
  sun.position.copy(camera.position).addScaledVector(sunDir, 500);

  sunLight.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  sunLight.uSunColor.value.copy(sun.color);
  post.render(sunDir, sun.color);
});

// Fill all grass before the first frame so the opening view isn't bare.
grass.update(camera.position, Infinity);

// Debug handle for automated screenshots.
Object.assign(window, { __app: { camera, scene, renderer, settings, updateSun, cubeTarget, skyScene, grass, trees, height, post } });
