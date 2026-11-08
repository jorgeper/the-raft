import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
