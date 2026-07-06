import { test, expect } from '@playwright/test';
import { login, JORGE } from './helpers';

test.describe('analytics', () => {
  test('generated data shows up in stats, records, and charts', async ({ page }) => {
    await login(page, JORGE);

    // Turn on developer mode and generate two weeks of history.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('group', { name: 'Developer mode' }).getByRole('button', { name: 'On' }).click();
    await page.getByRole('button', { name: 'Generate 2 weeks of test data' }).click();
    await expect(page.getByText(/Generated \d+ workout days/)).toBeVisible();

    await page.getByRole('link', { name: 'Analytics' }).click();

    // Summary tiles are populated.
    await expect(page.getByTestId('stat-workouts')).not.toHaveText('0');

    // PRs and the auto-selected chart render.
    await expect(page.getByRole('heading', { name: 'Personal records' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Max weight progression chart' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Volume progression chart' })).toBeVisible();

    // Chart a second exercise.
    await page.getByRole('button', { name: '+ Chart an exercise' }).click();
    await page.getByLabel('Search exercises to chart').fill('Squat');
    await page.getByRole('button', { name: 'Squat', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Squat from charts' })).toBeVisible();
  });
});
