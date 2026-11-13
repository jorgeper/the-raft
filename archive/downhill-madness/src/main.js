import * as THREE from 'three';
import { createRenderer } from './engine/renderer.js';
import { createLoop } from './engine/loop.js';
import { createSky } from './world/sky.js';
import { createChunkManager } from './world/chunks.js';
import { windUniform } from './world/vegetation.js';
import { centerX, groundY, TRAIL_HALF_WIDTH } from './world/trail.js';
import { phaseParamsAt } from './world/phases.js';
import { offTrailHeight } from './world/terrain.js';
import { createFx } from './world/fx.js';
import { createInput } from './input/input.js';
import { buildCharacter } from './player/model.js';
import { createPuppet } from './player/puppet.js';
import { createController } from './player/controller.js';
import { createRagdoll } from './player/ragdoll.js';
import { MAX_SPEED } from './player/speed.js';
import { createSpawner, spawnedTypes } from './obstacles/spawner.js';
import { createScore, createBestStore, POINTS, spinPoints, airPoints } from './scoring/score.js';
import { createStyleDetector } from './scoring/style.js';
import { createHud, toScreen } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { createAudio } from './audio/audio.js';
import { playerBox, overlaps, passesOver } from './utils/aabb.js';
import { clamp, lerp, damp } from './utils/math.js';
import { flatMat, box as helperBox } from './obstacles/helpers.js';

// ---------------------------------------------------------------- setup
const { renderer, camera } = createRenderer(document.getElementById('app'));
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc5dcef, 0.004);
const sky = createSky(scene);

// camera-relative rendering: player stays near origin, world shifts (spec §5)
const worldGroup = new THREE.Group();
scene.add(worldGroup);

const spawner = createSpawner(worldGroup);
const chunkManager = createChunkManager(worldGroup, { spawner });
const fx = createFx(worldGroup);
const input = createInput();
const hud = createHud();
const screens = createScreens();
const audio = createAudio();
const bestStore = createBestStore(window.localStorage);
const score = createScore();
const styleDetector = createStyleDetector();

// trailhead sign the poor guy trips over
const sign = new THREE.Group();
{
  const post = helperBox(0.12, 1.3, 0.12, flatMat(0x7a5a3c), 0, 0.65, 0);
  const board = helperBox(1.5, 0.6, 0.08, flatMat(0x9a7448), 0, 1.35, 0);
  board.rotation.z = 0.04;
  sign.add(post, board);
  sign.position.set(centerX(1) - 2.6, groundY(1), -1);
  worldGroup.add(sign);
}

const groundHeightAt = (x, z) => {
  const s = -z;
  const l = x - centerX(s);
  return groundY(s) + offTrailHeight(s, l);
};

// ---------------------------------------------------------------- player
let character = null;
let animator = null;
let ragdoll = null;
let ragGroup = null;

function buildPlayer() {
  if (character) {
    scene.remove(character.root);
    character.root.traverse((o) => o.geometry?.dispose());
  }
  if (ragGroup) {
    worldGroup.remove(ragGroup);
    ragGroup.traverse((o) => o.geometry?.dispose());
  }
  character = buildCharacter();
  scene.add(character.root);
  animator = createPuppet(character);
  ragGroup = new THREE.Group();
  worldGroup.add(ragGroup);
  ragdoll = createRagdoll(character, {
    groundHeightAt,
    nearbyBoxesWorld: ragdollObstacleBoxes,
  });
}

const controllerEvents = {
  onJump: (mult) => { (mult > 1.05 ? audio.bigJump : audio.jump)(); },
  onLand: (airTime, ramped) => {
    audio.land();
    animator?.jolt(3);
    fx.landPuff(controller.p.s, controller.p.l);
    if (airTime > 0.55) {
      const pts = airPoints(airTime, ramped);
      if (pts > 0) awardStyle(`+${pts} AIR${ramped ? ' ×2' : ''}`, pts, false);
    }
  },
  onSpins: (n) => {
    const pts = spinPoints(n);
    awardStyle(`+${pts} SPIN${n > 1 ? ` ×${n}` : ''}!`, pts, true);
    audio.score(true);
  },
  onSpinStart: () => audio.spin(),
  onStumble: () => {
    audio.stumble();
    animator?.jolt(9);
    shake = Math.min(1, shake + 0.7);
  },
  onCrash: () => beginCrash(),
};
const controller = createController(controllerEvents);

function awardStyle(label, pts, big) {
  const t = controller.p.runTime;
  const { comboBonus } = score.addStyle(t, label.replace(/^\+\d+ /, ''), pts);
  const pos = character.root.position.clone().add(new THREE.Vector3(0, 2, 0));
  const scr = toScreen(pos, camera);
  if (!scr.behind) hud.popup(label, scr.x + (Math.sin(t * 13) * 40), scr.y - 20, big);
  if (comboBonus > 0) { hud.combo(); audio.score(true); }
  else if (!big) audio.score(false);
}

// obstacle AABBs near the crash site, in track-world space for the ragdoll
function ragdollObstacleBoxes() {
  const out = [];
  for (const inst of chunkManager.activeObstacles(controller.p.s)) {
    for (const b of inst.boxes) {
      if (b.kind === 'zone') continue;
      const cx = centerX(b.s) + b.l;
      const cy = groundY(b.s) + b.y;
      out.push({
        min: new THREE.Vector3(cx - b.hl, cy - b.hy, -(b.s + b.hs)),
        max: new THREE.Vector3(cx + b.hl, cy + b.hy, -(b.s - b.hs)),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- game state
let state = 'start'; // start | run | crash | end
let elapsed = 0;
let shake = 0;
let crashRealTime = 0;
let starsShown = false;
// dev/testing helpers: ?seed=N deterministic runs, ?start=M begin at M meters,
// ?ghost=1 no collisions (visual inspection of late phases)
const urlParams = new URLSearchParams(location.search);
let runSeedCounter = Number(urlParams.get('seed')) || 1;
const startAtS = Number(urlParams.get('start')) || 0;
const ghostMode = urlParams.get('ghost') === '1';
let fov = 60;
const prevSnap = { s: 0, l: 0, footY: 0 };
const curSnap = { s: 0, l: 0, footY: 0 };

function startRun() {
  runSeedCounter = (runSeedCounter * 1103515245 + 12345) >>> 0 || 1;
  spawner.setRunSeed(runSeedCounter);
  chunkManager.reset();
  controller.reset();
  if (startAtS > 0) {
    controller.p.s = startAtS;
    controller.p.runTime = (Math.sqrt(49 + 0.56 * startAtS) - 7) / 0.28;
  }
  score.reset();
  styleDetector.reset();
  buildPlayer();
  fx.hideStars();
  starsShown = false;
  chunkManager.update(0);
  screens.hideAll();
  hud.show();
  state = 'run';
  animator.jolt(7); // trips over the trailhead sign
  setTimeout(() => {
    const scr = toScreen(character.root.position.clone().add(new THREE.Vector3(0, 2.2, 0)), camera);
    hud.popup('WHOOPS!', scr.x, scr.y, true);
  }, 350);
}

function beginCrash() {
  state = 'crash';
  crashRealTime = 0;
  const p = controller.p;
  // launch velocity along the trail direction at current speed
  const ds = 0.5;
  const dir = new THREE.Vector3(
    (centerX(p.s + ds) - centerX(p.s)) / ds,
    (groundY(p.s + ds) - groundY(p.s)) / ds,
    -1
  ).normalize().multiplyScalar(p.speed);
  ragdoll.activate(dir, ragGroup, worldGroup.position.clone());
  loop.setTimeScale(0.3); // slow-mo highlight reel (spec §4.4)
  audio.crash();
  screens.flash();
  shake = 1;
  // startle every critter nearby (spec §7.1)
  for (const inst of chunkManager.activeObstacles(p.s)) {
    if (inst.def.name === 'sheep') { inst.data.fled = true; }
    if (inst.def.name === 'chickens') { inst.data.scattered = true; }
  }
}

function endRun() {
  state = 'end';
  loop.setTimeScale(1);
  hud.hide();
  score.setDistance(controller.p.s);
  const total = score.total();
  const isNewBest = bestStore.submit(total, score.state.distance);
  screens.showEnd({
    distance: score.state.distance,
    breakdown: score.breakdown(),
    style: score.state.style,
    total,
    isNewBest,
    best: bestStore.get(),
  });
  audio.endBirds();
}

// ---------------------------------------------------------------- collisions & zones
function handleCollisions(dt) {
  const p = controller.p;
  const pBox = playerBox(p.s, p.l, p.footY);
  const active = chunkManager.activeObstacles(p.s);
  let collided = false;

  // narrows squeeze zones (spec §6.1 #17)
  let half = TRAIL_HALF_WIDTH;
  for (const inst of active) {
    if (inst.def.zone) {
      const z = inst.def.zone(inst);
      if (p.s > z.sStart - 2 && p.s < z.sEnd + 2) half = Math.min(half, z.halfWidth);
    }
  }
  controller.setHalfWidth(half);

  const zctx = {
    grounded: p.state === 'running',
    jumpBuffered: input.peekJumpBuffered(),
    controller, audio, fx, hud,
    playerL: p.l, playerS: p.s,
  };

  for (const inst of active) {
    if (ghostMode) break;
    for (const b of inst.boxes) {
      if (!overlaps(pBox, b)) continue;
      if (b.kind === 'zone') {
        inst.def.onZone?.(inst, zctx);
      } else if (b.kind === 'soft') {
        if (passesOver(p.footY, b)) continue;
        collided = true;
        const result = inst.def.onHit ? inst.def.onHit(inst, zctx) : 'stumble';
        if (result === 'stumble') controller.stumble(inst.def.name);
        else if (result === 'crash') controller.crash(inst.def.name);
      } else {
        if (passesOver(p.footY, b)) continue;
        collided = true;
        controller.crash(inst.def.name);
      }
      if (p.state === 'crashed') return;
    }
  }

  // style: near-misses & threading (spec §4.5)
  const events = styleDetector.detectPasses(active, p, collided);
  for (const ev of events) {
    if (ev.kind === 'nearMiss') { awardStyle(`+${POINTS.nearMiss} CLOSE!`, POINTS.nearMiss, false); audio.nearMiss(); }
    else if (ev.kind === 'thread') awardStyle(`+${POINTS.threading} THREADED!`, POINTS.threading, true);
  }
}

// ---------------------------------------------------------------- fixed update
let strideAcc = 0;

function update(dt) {
  elapsed += dt;
  windUniform.value = elapsed;

  if (state === 'start') {
    // gentle idle drift at the trailhead; the dude jogs in place, oblivious
    chunkManager.update(10);
    animator?.update(dt, {
      speed: 2.5, steer: 0, grounded: true, vy: 0, footY: 0,
      lateralVel: 0, stumbling: false, spinning: false,
    });
    return;
  }

  if (state === 'run') {
    prevSnap.s = controller.p.s; prevSnap.l = controller.p.l; prevSnap.footY = controller.p.footY;
    controller.update(dt, input);
    const p = controller.p;
    curSnap.s = p.s; curSnap.l = p.l; curSnap.footY = p.footY;

    chunkManager.update(p.s);
    const octx = {
      playerS: p.s, playerL: p.l, playerFootY: p.footY, playerSpeed: p.speed,
      audio, fx, hud,
      addStyle: (label, kind, inst) => awardStyle(`+${POINTS.scatter} SCATTER!`, POINTS.scatter, false),
    };
    for (const inst of chunkManager.allObstacles()) inst.def.update?.(inst, dt, octx);
    if (state !== 'run') return; // an obstacle may have crashed us
    handleCollisions(dt);
    if (state !== 'run') return;

    score.setDistance(p.s);

    // physics puppet + footsteps
    animator.update(dt, {
      speed: p.speed, steer: p.steer,
      grounded: p.state === 'running',
      vy: p.vy, footY: p.footY,
      lateralVel: (p.l - prevSnap.l) / dt,
      stumbling: controller.isStumbling(),
      spinning: p.spinning,
    });
    if (p.state === 'running') {
      strideAcc += dt * (1.7 + p.speed * 0.115) * 2;
      if (strideAcc >= 1) {
        strideAcc = 0;
        audio.footstep(clamp((p.speed - 10) / 20, 0, 1));
      }
    }
    audio.setWind(clamp(p.speed / MAX_SPEED, 0, 1));
    shake = Math.max(0, shake - dt * 2);
  }

  if (state === 'crash' || state === 'end') {
    ragdoll.update(dt);
    for (const inst of chunkManager.allObstacles()) {
      if (['sheep', 'chickens'].includes(inst.def.name)) {
        inst.def.update?.(inst, dt, {
          playerS: controller.p.s, playerL: controller.p.l, playerSpeed: 0,
          audio, addStyle: null,
        });
      }
    }
    if (state === 'end' && ragdoll.isSettled() && !starsShown) {
      starsShown = true;
      const hp = ragdoll.headPos();
      if (hp) fx.showStars(hp);
    }
  }

  fx.update(dt, controller.p.s, phaseParamsAt(controller.p.s).mix);
}

// ---------------------------------------------------------------- render
let camL = 0;
let orbitAngle = 0;

function render(alpha, frameDt) {
  const p = controller.p;
  const s = state === 'run' ? lerp(prevSnap.s, curSnap.s, alpha) : p.s;
  const l = state === 'run' ? lerp(prevSnap.l, curSnap.l, alpha) : p.l;
  const footY = state === 'run' ? lerp(prevSnap.footY, curSnap.footY, alpha) : p.footY;

  const phase = phaseParamsAt(s);
  sky.applyPhase(phase, elapsed);
  scene.fog.color.setRGB(...phase.fog);
  scene.fog.density = phase.fogDensity;

  if (state === 'crash' || state === 'end') {
    // slow orbit pull-out around the wreckage (spec §7.1)
    crashRealTime += frameDt;
    if (state === 'crash' && crashRealTime > 1.55) endRun();
    const hips = ragdoll.hipsPos();
    if (hips) {
      const target = hips.clone().add(worldGroup.position);
      orbitAngle += frameDt * 0.35;
      const dist = 5 + Math.min(2.5, crashRealTime * 1.2);
      camera.position.lerp(
        new THREE.Vector3(
          target.x + Math.sin(orbitAngle) * dist,
          target.y + 2.6,
          target.z + Math.cos(orbitAngle) * dist
        ),
        0.06
      );
      camera.lookAt(target);
    }
    fov = damp(fov, 55, 2, frameDt);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return;
  }

  // world shifts so the player sits at the origin
  const wx = centerX(s) + l, wy = groundY(s), wz = -s;
  worldGroup.position.set(-wx, -wy, -wz);

  if (character) {
    character.root.position.set(0, footY, 0);
    // face down-trail
    const aheadX = centerX(s + 4) - centerX(s);
    character.root.rotation.y = Math.atan2(-aheadX, 4);
    if (p.spinning) character.visual.rotation.y = p.spinAngle;
    else character.visual.rotation.y *= 0.8;
  }

  if (state === 'start') {
    orbitAngle += frameDt * 0.1;
    camera.position.set(Math.sin(orbitAngle) * 1.5, 2.6, 5.5);
    camera.lookAt(0, 1.4, -6);
    fov = 60;
  } else {
    camL = damp(camL, l * 0.25, 5, frameDt);
    const speedT = clamp((p.speed - 7) / (MAX_SPEED - 7), 0, 1);
    fov = damp(fov, 60 + 15 * speedT, 3, frameDt); // spec §7: 60° → 75°
    const shakeAmp = shake * 0.12 + speedT * 0.035;
    // high chase cam: 3.5 m up / 6.5 m back, pitched down the trail so
    // oncoming obstacles read clearly at speed (spec §7)
    camera.position.set(
      camL * 0.3 + Math.sin(elapsed * 31) * shakeAmp,
      3.5 + footY * 0.3 + Math.sin(elapsed * 41) * shakeAmp * 0.7,
      6.5
    );
    const lookAhead = 14;
    const lookX = (centerX(s + lookAhead) - centerX(s)) * 0.85 + camL;
    const lookY = 0.2 + (groundY(s + lookAhead) - groundY(s)) * 0.55 + footY * 0.25;
    camera.lookAt(lookX, lookY, -lookAhead);
  }
  camera.fov = fov;
  camera.updateProjectionMatrix();

  if (state === 'run') {
    hud.update(p.s, p.speed, score.state.style, frameDt);
  }

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- wiring
const loop = createLoop({ update, render });

input.onAny(() => {
  audio.ensure();
  if (state === 'start') startRun();
  else if (state === 'end') startRun(); // instant retry (spec §9)
});
input.onMute(() => updateMuteButton(audio.toggleMute()));

const muteBtn = document.getElementById('muteBtn');
function updateMuteButton(muted) { muteBtn.textContent = muted ? '🔇' : '🔊'; }
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  audio.ensure();
  updateMuteButton(audio.toggleMute());
});
updateMuteButton(audio.isMuted());

// pause on Esc / tab-away (spec §9)
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'run') {
    paused = !paused;
    if (paused) loop.stop(); else loop.start();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop();
  else if (!paused) loop.start();
});

screens.showStart(bestStore.get());
chunkManager.update(10);
buildPlayer(); // he jogs in place behind the title screen
loop.start();

// dev/testing introspection (acceptance §11: fps + leak checks)
let frames = 0, fpsWindowStart = performance.now(), lastFps = 0;
(function fpsCounter() {
  requestAnimationFrame(() => {
    frames++;
    const now = performance.now();
    if (now - fpsWindowStart > 1000) {
      lastFps = frames / ((now - fpsWindowStart) / 1000);
      frames = 0;
      fpsWindowStart = now;
    }
    fpsCounter();
  });
})();
window.__dm = {
  get fps() { return lastFps; },
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  get geometries() { return renderer.info.memory.geometries; },
  get textures() { return renderer.info.memory.textures; },
  get state() { return state; },
  get sceneObjects() { let n = 0; scene.traverse(() => n++); return n; },
  get worldChildren() { return worldGroup.children.length; },
  get obstacleMeshes() {
    let n = 0;
    worldGroup.traverse((o) => { if (o.isMesh) n++; });
    return n;
  },
  get breakdown() {
    const spawnerGroup = worldGroup.children.find((c) => c.userData.isObstacleGroup);
    let obst = 0;
    spawnerGroup?.traverse((o) => { if (o.isMesh) obst++; });
    return { obstacleGroupMeshes: obst, obstacleGroupChildren: spawnerGroup?.children.length ?? -1 };
  },
  get distance() { return controller.p.s; },
  get speed() { return controller.p.speed; },
  get style() { return score.state.style; },
  get spawned() { return [...spawnedTypes].sort(); },
};
