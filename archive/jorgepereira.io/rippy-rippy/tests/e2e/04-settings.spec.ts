import path from 'path';
import { test, expect } from '@playwright/test';
import { login, addExercise, JORGE } from './helpers';

test.describe('settings', () => {
  test('weight unit toggle changes the labels on the day screen', async ({ page }) => {
    await login(page, JORGE);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('group', { name: 'Weight unit' }).getByRole('button', { name: 'Kilograms (kg)' }).click();

    await page.goto('/?date=2025-12-01');
    await addExercise(page, 'Unit Press');
    const card = page.getByTestId('exercise-card').filter({ hasText: 'Unit Press' });
    await card.getByRole('button', { name: '+ Add set' }).click();
    await expect(card.getByText('kg', { exact: true })).toBeVisible();

    // Back to pounds for the rest of the suite.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('group', { name: 'Weight unit' }).getByRole('button', { name: 'Pounds (lb)' }).click();
  });

  test('display name changes show up in the account menu', async ({ page }) => {
    await login(page, JORGE);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Display name').fill('Rippy Jorge');
    await page.getByLabel('Display name').press('Enter');
    await expect(page.getByText('Signed in as jorge@test.com')).toBeVisible();

    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menu').getByText('Rippy Jorge')).toBeVisible();
  });

  test('upload a profile photo, then remove it again', async ({ page }) => {
    await login(page, JORGE);
    await page.getByRole('link', { name: 'Settings' }).click();

    // No photo yet (dev login has no Google picture) → initials avatar.
    await expect(page.getByRole('button', { name: 'Account' }).locator('img')).toHaveCount(0);

    await page.getByLabel('Choose profile photo').setInputFiles(
      path.resolve(__dirname, '../../client/public/icon-192.png')
    );
    await expect(page.getByRole('dialog', { name: 'Adjust photo' })).toBeVisible();
    const usePhoto = page.getByRole('button', { name: 'Use photo' });
    await expect(usePhoto).toBeEnabled();
    await usePhoto.click();

    // The header avatar becomes a real image.
    await expect(page.getByRole('button', { name: 'Account' }).locator('img')).toHaveCount(1);

    // Remove it (no Google photo to fall back to) → initials again.
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: 'Account' }).locator('img')).toHaveCount(0);
  });
});
