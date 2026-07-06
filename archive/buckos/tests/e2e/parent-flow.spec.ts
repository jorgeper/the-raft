import { test, expect } from '@playwright/test';
import { addKid, loginAs, uid } from './helpers';

test('parent adds a kid, gives and takes Buckos, and sees the ledger update', async ({ page }) => {
  const name = `Kid${uid()}`;
  const email = `${name.toLowerCase()}@gmail.com`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email });

  const card = page.locator('article').filter({ hasText: name });
  await expect(card.getByText('Ƀ 100', { exact: true })).toBeVisible();

  // Give 5 with a note
  await card.getByRole('button', { name: 'Give' }).click();
  await page.getByLabel('How many Buckos?').fill('5');
  await page.getByLabel('What for?').fill('Helped with dishes');
  await page.getByRole('button', { name: 'Give Buckos' }).click();
  await expect(card.getByText('Ƀ 105', { exact: true })).toBeVisible();

  // Take 15 with a note
  await card.getByRole('button', { name: 'Take' }).click();
  await page.getByLabel('How many Buckos?').fill('15');
  await page.getByLabel('What for?').fill('Left bike in the rain');
  await page.getByRole('button', { name: 'Take Buckos' }).click();
  await expect(card.getByText('Ƀ 90', { exact: true })).toBeVisible();

  // Detail page shows the full ledger with signed amounts
  await page.getByRole('heading', { name }).click();
  await page.waitForURL('**/kids/*');
  await expect(page.getByText('Helped with dishes')).toBeVisible();
  await expect(page.getByText('+5', { exact: true })).toBeVisible();
  await expect(page.getByText('Left bike in the rain')).toBeVisible();
  await expect(page.getByText('−15', { exact: true })).toBeVisible();
  await expect(page.getByText('Weekly reset to 100')).toBeVisible();
});

test('parent can edit a kid and remove a kid', async ({ page }) => {
  const name = `Kid${uid()}`;
  const renamed = `${name}X`;

  await loginAs(page, 'dad@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com`, allowance: 40 });

  await page.getByRole('heading', { name }).click();
  await page.waitForURL('**/kids/*');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill(renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove kid' }).click();
  await page.waitForURL('**/');
  await expect(page.getByRole('heading', { name: renamed })).toHaveCount(0);
});
