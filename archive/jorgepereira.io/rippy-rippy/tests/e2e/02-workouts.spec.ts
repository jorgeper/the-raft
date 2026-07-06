import { test, expect } from '@playwright/test';
import { login, addExercise, waitForSave, JORGE } from './helpers';

test.describe('saved workouts', () => {
  test('save a day as a template and load it with pre-filled weights', async ({ page }) => {
    await login(page, JORGE);

    await page.goto('/?date=2025-11-03');
    await addExercise(page, 'Tpl Press');
    const press = page.getByTestId('exercise-card').filter({ hasText: 'Tpl Press' });
    await press.getByRole('button', { name: '+ Add set' }).click();
    await page.getByLabel('Tpl Press set 1 weight').fill('100');
    await page.getByLabel('Tpl Press set 1 reps').fill('8');
    await addExercise(page, 'Tpl Row');

    await page.getByRole('button', { name: 'Save as workout' }).click();
    await page.getByLabel('Workout name').fill('E2E Template');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await waitForSave(page);

    // Load it into a later day: weights come from the last session.
    await page.goto('/?date=2025-11-05');
    await page.getByRole('button', { name: 'Load workout' }).click();
    await page.getByRole('button', { name: /E2E Template/ }).click();
    await expect(page.getByTestId('exercise-card').filter({ hasText: 'Tpl Row' })).toBeVisible();
    await expect(page.getByLabel('Tpl Press set 1 weight')).toHaveValue('100');
    await expect(page.getByLabel('Tpl Press set 1 reps')).toHaveValue('8');
    await waitForSave(page);
  });

  test('manage workouts: create, edit, delete', async ({ page }) => {
    await login(page, JORGE);
    await page.getByRole('link', { name: 'Workouts' }).click();
    await expect(page.getByText('E2E Template', { exact: true })).toBeVisible();

    // Create a new one from scratch.
    await page.getByRole('button', { name: '+ New workout' }).click();
    await page.getByLabel('Workout name').fill('Trash Workout');
    await page.getByRole('button', { name: '+ Add exercise' }).click();
    await page.getByLabel('Search exercises').fill('Tpl Press');
    await page.getByRole('button', { name: 'Tpl Press' }).first().click();
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page.getByText('Trash Workout', { exact: true })).toBeVisible();

    // Rename via edit.
    await page
      .locator('div', { hasText: 'E2E Template' })
      .getByRole('button', { name: 'Edit' })
      .first()
      .click();
    await page.getByLabel('Workout name').fill('E2E Template 2');
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page.getByText('E2E Template 2', { exact: true })).toBeVisible();

    // Delete with confirmation.
    await page.getByRole('button', { name: 'Delete Trash Workout' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Trash Workout', { exact: true })).toHaveCount(0);
  });
});
