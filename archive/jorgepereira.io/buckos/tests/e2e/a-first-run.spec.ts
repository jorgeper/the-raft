import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

// Runs first (alphabetical order, single worker) against the fresh database.
test('first run shows the friendly empty state with a call to action', async ({ page }) => {
  await loginAs(page, 'mom@gmail.com');
  await expect(page.getByRole('heading', { name: 'Start the family bank' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first kid' })).toBeVisible();
});
