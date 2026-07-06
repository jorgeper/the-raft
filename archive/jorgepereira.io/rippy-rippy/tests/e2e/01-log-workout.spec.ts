import { test, expect } from '@playwright/test';
import { login, addExercise, waitForSave, JORGE } from './helpers';

test.describe('logging a workout', () => {
  test('add exercise, log sets, run the timer, survive a reload', async ({ page }) => {
    await login(page, JORGE);

    await addExercise(page, 'E2E Bench');
    const card = page.getByTestId('exercise-card').filter({ hasText: 'E2E Bench' });
    await expect(card.getByText('First time!')).toBeVisible();

    // First set starts empty (brand-new exercise) — add and fill it.
    await card.getByRole('button', { name: '+ Add set' }).click();
    await page.getByLabel('E2E Bench set 1 weight').fill('135');
    await page.getByLabel('E2E Bench set 1 reps').fill('10');

    // A second set duplicates the previous one.
    await card.getByRole('button', { name: '+ Add set' }).click();
    await expect(page.getByLabel('E2E Bench set 2 weight')).toHaveValue('135');
    await expect(page.getByLabel('E2E Bench set 2 reps')).toHaveValue('10');

    // Clearing a field mid-edit must not write 0 (bug #6): blur restores.
    await page.getByLabel('E2E Bench set 1 weight').fill('');
    await page.getByLabel('E2E Bench set 1 reps').click();
    await expect(page.getByLabel('E2E Bench set 1 weight')).toHaveValue('135');

    // Timer: start, tick, stop — elapsed derives from timestamps.
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByTestId('timer-display')).not.toHaveText('00:00:00', { timeout: 3000 });
    await page.getByRole('button', { name: 'Stop' }).click();

    await waitForSave(page);
    await page.reload();

    await expect(page.getByTestId('exercise-card').filter({ hasText: 'E2E Bench' })).toBeVisible();
    await expect(page.getByLabel('E2E Bench set 1 weight')).toHaveValue('135');
    await expect(page.getByTestId('timer-display')).not.toHaveText('00:00:00');
  });

  test('the next session shows last weights and pre-fills them', async ({ page }) => {
    await login(page, JORGE);
    await page.getByRole('button', { name: 'Next day' }).click();

    await addExercise(page, 'E2E Bench');
    const card = page.getByTestId('exercise-card').filter({ hasText: 'E2E Bench' });
    await expect(card.getByText(/Last: 135 lb × 10/)).toBeVisible();
    // Pre-filled from the last session.
    await expect(page.getByLabel('E2E Bench set 1 weight')).toHaveValue('135');
  });
});
