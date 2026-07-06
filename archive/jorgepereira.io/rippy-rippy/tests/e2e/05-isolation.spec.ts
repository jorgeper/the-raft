import { test, expect } from '@playwright/test';
import { login, logout, JORGE, FRIEND } from './helpers';

test.describe('user isolation', () => {
  test('a second user sees none of the first user’s data', async ({ page }) => {
    // Jorge has data from the other specs; sanity-check that he does.
    await login(page, JORGE);
    await page.goto('/?date=2025-11-03');
    await expect(page.getByTestId('exercise-card').first()).toBeVisible();
    await logout(page);

    await login(page, FRIEND);

    // Friend's same date is an untouched rest day.
    await page.goto('/?date=2025-11-03');
    await expect(page.getByText(/Rest day so far/)).toBeVisible();
    await expect(page.getByTestId('exercise-card')).toHaveCount(0);

    // No saved workouts.
    await page.getByRole('link', { name: 'Workouts' }).click();
    await expect(page.getByText('No saved workouts yet', { exact: false })).toBeVisible();

    // Analytics are empty.
    await page.getByRole('link', { name: 'Analytics' }).click();
    await expect(page.getByText('Nothing to chart yet', { exact: false })).toBeVisible();

    // And Jorge's exercises don't leak into friend's suggestions.
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('button', { name: '+ Add exercise' }).click();
    await page.getByLabel('Search exercises').fill('E2E Bench');
    await expect(page.getByRole('button', { name: 'E2E Bench', exact: true })).toHaveCount(0);
  });
});
