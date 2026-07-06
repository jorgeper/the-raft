import { test, expect } from '@playwright/test';
import { addKid, loginAs, logout, uid } from './helpers';

test('kid sees a read-only view of only their own data', async ({ page }) => {
  const name = `Kid${uid()}`;
  const email = `${name.toLowerCase()}@gmail.com`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email });
  await logout(page);

  await loginAs(page, email);

  // Their own read-only page: balance, chart, ledger.
  await expect(page.getByText(`, ${name}! You have`)).toBeVisible();
  await expect(page.getByText('Your week in Ƀuckos')).toBeVisible();
  await expect(page.getByText('Weekly reset to 100')).toBeVisible();

  // No admin affordances anywhere.
  await expect(page.getByRole('button', { name: 'Give' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /add.*kid/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  // Deep-linking into parent routes bounces back to their own page.
  await page.goto('/kids/1');
  await page.waitForURL('**/');
  await expect(page.getByText('Your week in Ƀuckos')).toBeVisible();

  // And the parent API is forbidden server-side, not just hidden.
  expect((await page.request.get('/api/kids')).status()).toBe(403);
  expect(
    (await page.request.post('/api/kids/1/transactions', { data: { amount: 5, note: 'x', direction: 'add' } })).status()
  ).toBe(403);
  expect((await page.request.delete('/api/kids/1')).status()).toBe(403);
});

test('kids cannot see other kids in their summary', async ({ page }) => {
  const a = `KidA${uid()}`;
  const b = `KidB${uid()}`;
  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name: a, email: `${a.toLowerCase()}@gmail.com` });
  await addKid(page, { name: b, email: `${b.toLowerCase()}@gmail.com` });
  await logout(page);

  await loginAs(page, `${a.toLowerCase()}@gmail.com`);
  const summary = await (await page.request.get('/api/kid/summary')).json();
  expect(summary.kid.name).toBe(a);
  await expect(page.getByText(b)).toHaveCount(0);
});
