import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/valheim-colors/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8002",
      "/login": "http://localhost:8002",
      "/auth": "http://localhost:8002",
    },
  },
});
