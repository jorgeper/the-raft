import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button').filter({ hasText: email }).click();
  await page.waitForURL('**/');
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL('**/login');
}

export async function addKid(
  page: Page,
  kid: { name: string; email: string; allowance?: number }
): Promise<void> {
  await page.getByRole('button', { name: /add (your first )?kid/i }).click();
  await page.getByLabel('Name').fill(kid.name);
  await page.getByLabel('Gmail address').fill(kid.email);
  if (kid.allowance !== undefined) {
    await page.getByLabel('Weekly allowance').fill(String(kid.allowance));
  }
  await page.getByRole('button', { name: 'Add kid', exact: true }).click();
  await expect(page.getByRole('heading', { name: kid.name })).toBeVisible();
}

/** Unique-enough suffix so specs sharing one database never collide. */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
