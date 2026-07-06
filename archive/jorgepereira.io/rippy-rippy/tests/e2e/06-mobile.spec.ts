import { test, expect } from '@playwright/test';
import { login, addExercise, waitForSave, JORGE } from './helpers';

/** Core flow at iPhone size (see playwright.config.ts mobile project). */
test.describe('mobile', () => {
  test('log a workout end-to-end on a phone viewport', async ({ page }) => {
    await login(page, JORGE);
    await page.goto('/?date=2025-10-06');

    await addExercise(page, 'Mobile Press');
    const card = page.getByTestId('exercise-card').filter({ hasText: 'Mobile Press' });
    await card.getByRole('button', { name: '+ Add set' }).click();
    await page.getByLabel('Mobile Press set 1 weight').fill('50');
    await page.getByLabel('Mobile Press set 1 reps').fill('12');
    await waitForSave(page);

    await page.reload();
    await expect(page.getByLabel('Mobile Press set 1 weight')).toHaveValue('50');

    // Bottom tab bar navigates.
    await page.getByRole('link', { name: 'Analytics' }).click();
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
