import { expect, type Page } from '@playwright/test';

export const JORGE = 'jorge@test.com';
export const FRIEND = 'friend@test.com';

/** Dev-auth login via the pick-a-user screen. */
export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: email }).click();
  await expect(page.getByRole('heading', { name: /Today|,/ })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Add an exercise to the current day by name (creates it if new). */
export async function addExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add exercise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add exercise' });
  await dialog.getByLabel('Search exercises').fill(name);
  // Wait for suggestions to load — the create button can flicker away once an
  // exact match arrives from the server.
  await expect(dialog.getByText('Loading…')).toHaveCount(0);
  const create = dialog.getByRole('button', { name: new RegExp(`^Add .${escapeRegex(name)}.$`) });
  if (await create.count()) {
    await create.click();
  } else {
    // Suggestion buttons are named "<name> <pills/meta>…" — anchor on the start.
    await dialog.getByRole('button', { name: new RegExp(`^${escapeRegex(name)}`) }).first().click();
  }
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Wait out the 500ms debounce + PUT so a reload sees the saved day. */
export async function waitForSave(page: Page) {
  await page.waitForTimeout(900);
  await expect(page.getByText('Saving…')).toHaveCount(0);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
