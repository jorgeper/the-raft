import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite: builds the app and runs the real production server in dev auth
 * mode against a throwaway database. Specs share the server (workers: 1), so
 * each spec uses its own distinct exercise names.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3121',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // iPhone-sized chromium so the suite needs no webkit download.
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run build && rm -rf test-results/e2e-db && node dist/server/index.js',
    url: 'http://localhost:3121/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_MODE: 'dev',
      ALLOWED_EMAILS: 'jorge@test.com,friend@test.com',
      SESSION_SECRET: 'e2e-secret',
      DATABASE_PATH: 'test-results/e2e-db/rippy.db',
      PORT: '3121',
    },
  },
});
