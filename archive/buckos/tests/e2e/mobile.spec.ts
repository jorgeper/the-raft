import { test, expect } from '@playwright/test';
import { addKid, loginAs, uid } from './helpers';

test.use({ viewport: { width: 375, height: 740 } });

test('the whole parent flow works on a phone with no horizontal scroll', async ({ page }) => {
  const name = `Kid${uid()}`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com` });

  const card = page.locator('article').filter({ hasText: name });
  await expect(card.getByText('Ƀ 100', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Give' }).click();
  await page.getByLabel('How many Buckos?').fill('3');
  await page.getByLabel('What for?').fill('Made his bed');
  await page.getByRole('button', { name: 'Give Buckos' }).click();
  await expect(card.getByText('Ƀ 103', { exact: true })).toBeVisible();

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(scrollable, 'page must not scroll horizontally at 375px').toBe(false);
});

test('the kid view fits a phone', async ({ page }) => {
  const name = `Kid${uid()}`;
  const email = `${name.toLowerCase()}@gmail.com`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email });
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL('**/login');

  await loginAs(page, email);
  await expect(page.getByText('Your week in Buckos')).toBeVisible();
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(scrollable).toBe(false);
});
