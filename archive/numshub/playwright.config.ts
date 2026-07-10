import { defineConfig } from "@playwright/test";

// E2E runs against the Vite build served locally; the app detects the absence of
// Tauri and swaps in the mock IPC shim (src/ipc/mock.ts).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:1421",
    headless: true,
  },
  webServer: {
    command: "vite preview --port 1421 --strictPort",
    port: 1421,
    reuseExistingServer: false,
  },
});
