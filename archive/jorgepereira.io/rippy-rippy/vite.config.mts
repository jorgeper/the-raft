import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
    },
  },
  test: {
    root: '.',
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
  },
} as import('vite').UserConfig);
