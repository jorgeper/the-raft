import { test as base, expect } from '@playwright/test';

/**
 * Every test automatically collects browser console errors and page errors,
 * and fails at teardown if any occurred (SPEC §4: no console errors during
 * any E2E run).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(String(err)));
      await use(errors);
      expect(errors, 'browser console must stay clean during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
