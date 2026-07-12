import { describe, it, expect } from 'vitest';
import { SPAWN_TABLE, spawnSpacing, eligibleTypes, pickWeighted, COMBO_TABLE } from '../src/obstacles/tables.js';
import { REGISTRY } from '../src/obstacles/registry.js';

describe('spawn tables (spec §6.3)', () => {
  it('every table entry maps to a registered obstacle', () => {
    for (const e of SPAWN_TABLE) expect(REGISTRY[e.type], e.type).toBeDefined();
  });
  it('covers all 24 catalog obstacles', () => {
    expect(Object.keys(REGISTRY)).toHaveLength(24);
    expect(new Set(SPAWN_TABLE.map((e) => e.type)).size).toBe(24);
  });
  it('weights are positive', () => {
    for (const e of SPAWN_TABLE) expect(e.weight).toBeGreaterThan(0);
  });
  it('phase gating respects minDistance', () => {
    const early = eligibleTypes(10);
    expect(early.every((e) => e.minDistance <= 10)).toBe(true);
    expect(early.some((e) => e.type === 'rollingLog')).toBe(false);
    const late = eligibleTypes(1000);
    expect(late.some((e) => e.type === 'rollingLog')).toBe(true);
  });
  it('maxPerChunk caps heavies', () => {
    const withStream = eligibleTypes(400, { stream: 1 });
    expect(withStream.some((e) => e.type === 'stream')).toBe(false);
  });
  it('density increases monotonically with distance', () => {
    let prev = spawnSpacing(0);
    for (let s = 50; s <= 1200; s += 50) {
      const cur = spawnSpacing(s);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
    expect(spawnSpacing(0)).toBeCloseTo(25);
    expect(spawnSpacing(2000)).toBeCloseTo(7);
  });
  it('combo pairs reference registered types', () => {
    for (const [a, b] of COMBO_TABLE) {
      expect(REGISTRY[a]).toBeDefined();
      expect(REGISTRY[b]).toBeDefined();
    }
  });
  it('pickWeighted lands inside the table', () => {
    const entries = SPAWN_TABLE.slice(0, 5);
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(entries).toContain(pickWeighted(entries, roll));
    }
  });
});
