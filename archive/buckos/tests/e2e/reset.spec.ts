import { test, expect } from '@playwright/test';
import { addKid, loginAs, uid } from './helpers';

/** The Monday 00:00 boundary strictly after `from`, plus a few hours. */
function nextMondayMorning(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1);
  d.setHours(8);
  return d;
}

test.afterEach(async ({ request }) => {
  await request.delete('/api/test/clock');
});

test('weekly reset restores the allowance and writes a ledger entry', async ({ page }) => {
  const name = `Kid${uid()}`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com` });

  const card = page.locator('article').filter({ hasText: name });
  await card.getByRole('button', { name: 'Take' }).click();
  await page.getByLabel('How many Buckos?').fill('40');
  await page.getByLabel('What for?').fill('Skipped chores');
  await page.getByRole('button', { name: 'Take Buckos' }).click();
  await expect(card.getByText('Ƀ 60', { exact: true })).toBeVisible();

  // Freeze time just past the next Monday boundary and reload.
  await page.request.post('/api/test/clock', {
    data: { time: nextMondayMorning(new Date()).toISOString() },
  });
  await page.reload();
  await expect(card.getByText('Ƀ 100', { exact: true })).toBeVisible();

  await page.getByRole('heading', { name }).click();
  await page.waitForURL('**/kids/*');
  // Initial allowance + the Monday reset.
  await expect(page.getByText('Weekly reset to 100')).toHaveCount(2);
  await expect(page.getByText('+40', { exact: true })).toBeVisible(); // 60 -> 100
});

test('a server that slept through several Mondays catches up every reset', async ({ page }) => {
  const name = `Kid${uid()}`;

  await loginAs(page, 'mom@gmail.com');
  await addKid(page, { name, email: `${name.toLowerCase()}@gmail.com` });

  const threeWeeksOut = nextMondayMorning(new Date());
  threeWeeksOut.setDate(threeWeeksOut.getDate() + 14);
  await page.request.post('/api/test/clock', { data: { time: threeWeeksOut.toISOString() } });

  await page.reload();
  await page.getByRole('heading', { name }).click();
  await page.waitForURL('**/kids/*');
  await expect(page.getByText('Weekly reset to 100')).toHaveCount(4); // initial + 3 Mondays
});
