import * as THREE from 'three';
import { REGISTRY } from './registry.js';
import { eligibleTypes, pickWeighted, spawnSpacing, COMBO_TABLE, COMBO_CHANCE, COMBO_START } from './tables.js';
import { verifyPattern } from './fairness.js';
import { makeRng, hash2 } from '../utils/rng.js';
import { CHUNK_LENGTH } from '../world/trail.js';

const FIRST_OBSTACLE_S = 55; // breathing room off the start line
const FORCED_JUMP_CLEARANCE = 15; // spec §6.2

// which catalog entries have actually spawned (acceptance §11 #3)
export const spawnedTypes = new Set();

export function createSpawner(worldGroup) {
  const obstacleGroup = new THREE.Group();
  obstacleGroup.userData.isObstacleGroup = true;
  worldGroup.add(obstacleGroup);

  const pools = new Map(); // typeName -> group[]
  let runSeed = 1;
  let lastSpawnS = 0;
  let lastForcedJumpS = -Infinity;

  function obtain(typeName, rng) {
    const pool = pools.get(typeName) || [];
    const group = pool.pop() || REGISTRY[typeName].build(rng);
    group.visible = true;
    obstacleGroup.add(group);
    spawnedTypes.add(typeName);
    return { def: REGISTRY[typeName], group, s: 0, l: 0, boxes: [], data: {}, span: 0 };
  }

  function release(inst) {
    obstacleGroup.remove(inst.group);
    const pool = pools.get(inst.def.name) || [];
    pool.push(inst.group);
    pools.set(inst.def.name, pool);
  }

  function planChunk(index, rng) {
    const s0 = index * CHUNK_LENGTH;
    const sEnd = s0 + CHUNK_LENGTH;
    const plan = [];
    const counts = {};
    let s = Math.max(lastSpawnS + spawnSpacing(s0), s0, FIRST_OBSTACLE_S);
    while (s < sEnd) {
      const options = eligibleTypes(s, counts);
      if (options.length) {
        const entry = pickWeighted(options, rng.next());
        // forced-jump obstacles need a clean landing zone after them (§6.2)
        if (!(entry.forcedJump && s - lastForcedJumpS < FORCED_JUMP_CLEARANCE * 2)) {
          plan.push({ type: entry.type, s });
          counts[entry.type] = (counts[entry.type] || 0) + 1;
          if (entry.forcedJump) lastForcedJumpS = s;
          // long patterns (slalom, narrows) consume their own span
          if (entry.type === 'slalom' || entry.type === 'narrows') s += 40;
          // chaos-phase paired spawns (spec §6.3)
          if (s > COMBO_START && rng.chance(COMBO_CHANCE)) {
            const combo = rng.pick(COMBO_TABLE);
            const partner = combo[0] === entry.type ? combo[1] : combo[0];
            const pEntry = REGISTRY[partner] && s + 8 < sEnd ? partner : null;
            if (pEntry) plan.push({ type: pEntry, s: s + rng.range(6, 10) });
          }
        }
      }
      s += spawnSpacing(s) * rng.range(0.75, 1.35);
    }
    return plan;
  }

  return {
    setRunSeed(seed) {
      runSeed = seed;
      lastSpawnS = 0;
      lastForcedJumpS = -Infinity;
    },

    spawnChunk(index) {
      const rng = makeRng(hash2(index, runSeed));
      // up to 4 attempts to generate a certified-survivable pattern (§6.2)
      for (let attempt = 0; attempt < 4; attempt++) {
        const plan = planChunk(index, rng);
        const instances = [];
        const rects = [];
        for (const p of plan) {
          const inst = obtain(p.type, rng);
          inst.s = p.s;
          const footprints = inst.def.place(inst, rng) || [];
          rects.push(...footprints);
          instances.push(inst);
        }
        if (verifyPattern(rects)) {
          if (instances.length) lastSpawnS = Math.max(lastSpawnS, ...instances.map((i) => i.s + (i.span || 0)));
          return instances;
        }
        for (const inst of instances) release(inst);
      }
      // sparse fallback: statics only, generously spaced — always solvable
      const inst = obtain('smallRock', rng);
      inst.s = index * CHUNK_LENGTH + CHUNK_LENGTH / 2;
      inst.def.place(inst, rng);
      lastSpawnS = inst.s;
      return [inst];
    },

    releaseChunk(index, instances) {
      for (const inst of instances) release(inst);
    },
  };
}
