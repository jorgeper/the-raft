import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite. Builds the app and runs the real production server in dev auth
 * mode against a throwaway database, with the test clock enabled so specs can
 * cross weekly-reset boundaries.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3111',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && rm -rf test-results/e2e-db && node dist/server/index.js',
    url: 'http://localhost:3111/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_MODE: 'dev',
      PARENT_EMAILS: 'mom@gmail.com,dad@gmail.com',
      SESSION_SECRET: 'e2e-secret',
      DATABASE_PATH: 'test-results/e2e-db/buckos.db',
      RESET_DAY: '1',
      RESET_HOUR: '0',
      PORT: '3111',
      ENABLE_TEST_CLOCK: '1',
    },
  },
});
