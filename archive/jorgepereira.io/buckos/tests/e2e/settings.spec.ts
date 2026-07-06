import { test, expect } from '@playwright/test';
import { addKid, loginAs, uid } from './helpers';

test.afterEach(async ({ page }) => {
  // Restore the default via the API so other specs see allowance 100.
  await page.request.post('/api/auth/dev-login', { data: { email: 'mom@gmail.com' } });
  const res = await page.request.patch('/api/settings', { data: { weeklyAllowance: 100 } });
  expect(res.ok()).toBe(true);
});

test('changing the weekly allowance in settings applies to kids and new defaults', async ({ page }) => {
  const name = `Kid${uid()}`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com` });

  // Settings is reachable from the account menu.
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.waitForURL('**/settings');

  await page.getByLabel('Weekly allowance').fill('200');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  // Existing kids now reset to the new amount…
  await page.goto('/');
  const card = page.locator('article').filter({ hasText: name });
  await expect(card.getByText('Resets to Ƀ200 on Monday')).toBeVisible();

  // …and the add-kid form starts from the new default.
  await page.getByRole('button', { name: '+ Add kid' }).click();
  await expect(page.getByLabel('Weekly allowance')).toHaveValue('200');
});

test('a note is optional when giving Ƀuckos', async ({ page }) => {
  const name = `Kid${uid()}`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com` });

  const card = page.locator('article').filter({ hasText: name });
  await card.getByRole('button', { name: 'Give' }).click();
  // Quick-amount shortcut fills the number; no note typed.
  await page.getByRole('button', { name: 'Ƀ5', exact: true }).click();
  await page.getByRole('button', { name: 'Give Ƀuckos' }).click();
  await expect(card.getByText('Ƀ105', { exact: true })).toBeVisible();

  await page.getByRole('heading', { name }).click();
  await page.waitForURL('**/kids/*');
  await expect(page.getByText('Ƀuckos given')).toBeVisible();
});
