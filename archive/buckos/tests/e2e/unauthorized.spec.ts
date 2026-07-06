import { test, expect } from '@playwright/test';

test('an email that is not on the list is rejected', async ({ page }) => {
  const res = await page.request.post('/api/auth/dev-login', {
    data: { email: 'stranger@gmail.com' },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe('not-on-list');

  await page.goto('/not-allowed');
  await expect(page.getByRole('heading', { name: "You're not on the list yet" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a different account' })).toBeVisible();
});

test('anonymous visitors are sent to the login screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login');
  await expect(page.getByRole('heading', { name: 'Ƀuckos' })).toBeVisible();
});
