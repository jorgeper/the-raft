#!/usr/bin/env node
// SPEC §7.3 — typecheck, unit, build, e2e (against the production preview),
// then the single line VALIDATION: ALL PASSED only if everything passed.
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const steps = [
  ['typecheck', 'npx tsc --noEmit'],
  ['unit', 'npx vitest run'],
  ['build', 'npx vite build'],
  ['e2e', 'npx playwright test'],
];

for (const [name, cmd] of steps) {
  console.log(`\n=== ${name}: ${cmd} ===`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\nVALIDATION FAILED at step: ${name}`);
    process.exit(1);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}
const size = dirSize('dist');
console.log(`\ndist/ total size: ${(size / 1024 / 1024).toFixed(2)} MB`);
if (size > 2 * 1024 * 1024) {
  console.error('VALIDATION FAILED: dist/ exceeds 2 MB (SPEC §8.1)');
  process.exit(1);
}

console.log('\nVALIDATION: ALL PASSED');
