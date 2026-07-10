// SPEC §8: the validation harness. Runs every suite in order with verbose
// output (test names visible in the transcript) and ends with the magic line
// `VALIDATION: ALL PASSED` only if everything succeeded.

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH}` };

const steps = [
  {
    name: "Rust unit tests (R1–R8)",
    cmd: "cargo test --release",
    cwd: join(root, "src-tauri"),
  },
  {
    name: "Frontend unit tests (U1–U4)",
    cmd: "npx vitest run --reporter=verbose",
    cwd: root,
  },
  {
    name: "Frontend production build",
    cmd: "npm run build",
    cwd: root,
  },
  {
    name: "E2E tests (E1–E8, Playwright over the mocked-IPC shim)",
    cmd: "npx playwright test --reporter=list",
    cwd: root,
  },
  {
    name: "Integration tests (I1–I2, real engine)",
    cmd: "node scripts/validate-stt.mjs",
    cwd: root,
  },
];

for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  try {
    execSync(step.cmd, { cwd: step.cwd, stdio: "inherit", env });
  } catch {
    console.error(`\nVALIDATION FAILED at: ${step.name}`);
    process.exit(1);
  }
}

console.log("\nVALIDATION: ALL PASSED");
