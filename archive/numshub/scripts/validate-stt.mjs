// Integration tests I1 + I2 (SPEC §8.4): the REAL engine + cleanup pipeline.
//
// I1: transcribe fixtures/jfk.wav with Whisper tiny through the release CLI
//     and assert the famous sentence comes out.
// I2: pipe a disfluent fixture transcript through cleanup-only mode and assert
//     the exact expected output.
//
// The Whisper tiny download here is the ONLY network access in the harness;
// it lands in a cache and is skipped on subsequent runs.

import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = process.env.NUMSHUB_MODEL_CACHE ?? join(homedir(), ".cache", "numshub-validate");
const TINY_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";
const TINY_SHA256 = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
const TINY_PATH = join(CACHE_DIR, "ggml-tiny.bin");
const CLI = join(root, "src-tauri", "target", "release", "numshub");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// --- Ensure the CLI binary exists (built by `npm run tauri build` / cargo) ---
if (!existsSync(CLI)) {
  console.log("release binary missing; building (cargo build --release)…");
  execSync("cargo build --release --bin numshub", {
    cwd: join(root, "src-tauri"),
    stdio: "inherit",
    env: { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH}` },
  });
}

// --- Ensure Whisper tiny is cached (the harness's only permitted download) ---
mkdirSync(CACHE_DIR, { recursive: true });
if (existsSync(TINY_PATH) && sha256(TINY_PATH) === TINY_SHA256) {
  console.log(`I1: whisper-tiny cache hit (${TINY_PATH})`);
} else {
  console.log("I1: downloading whisper-tiny (~75 MB, once)…");
  execFileSync("curl", ["-sL", "-o", TINY_PATH, TINY_URL], { stdio: "inherit" });
  const got = sha256(TINY_PATH);
  if (got !== TINY_SHA256) fail(`whisper-tiny checksum mismatch: ${got}`);
  console.log("I1: checksum verified");
}

// --- I1: real transcription through engine + cleanup ---
const EXPECTED_SUBSTRING = "ask not what your country can do for you";
console.log("I1: transcribing fixtures/jfk.wav through the release CLI…");
const out = execFileSync(
  CLI,
  ["transcribe", "--model-path", TINY_PATH, "--engine", "whisper", join(root, "fixtures", "jfk.wav")],
  { encoding: "utf8" },
);
console.log(`I1 transcript: ${out.trim()}`);
if (!out.toLowerCase().includes(EXPECTED_SUBSTRING)) {
  fail(`I1: transcript does not contain "${EXPECTED_SUBSTRING}"`);
}
console.log("I1: PASSED — real engine + cleanup pipeline produced the expected sentence");

// --- I2: cleanup-only mode, exact expected output ---
const I2_INPUT = "so um i think we should uh ship it on on tuesday [BLANK_AUDIO]";
const I2_EXPECTED = "so i think we should ship it on tuesday";
const cleaned = execFileSync(CLI, ["clean"], { input: I2_INPUT, encoding: "utf8" }).trim();
console.log(`I2 cleaned: ${cleaned}`);
if (cleaned !== I2_EXPECTED) {
  fail(`I2: expected "${I2_EXPECTED}", got "${cleaned}"`);
}
console.log("I2: PASSED — cleanup-only mode matches the expected output exactly");
