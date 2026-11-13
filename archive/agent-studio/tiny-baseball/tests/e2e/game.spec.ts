// E1–E5 — SPEC §7.2. The app exposes window.__game (SPEC §1.3) so tests can
// drive the engine deterministically without depending on animation timing.
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __game: {
      state: Record<string, unknown>;
      dispatch(action: Record<string, unknown>): unknown;
      ffwd(seed: number): Record<string, unknown>;
    };
  }
}

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => (window.__game.state as { phase: string }).phase);
}

test('E1: boots clean — canvas visible, no console errors, no external requests', async ({ page }) => {
  const errors: string[] = [];
  const externals: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externals.push(url);
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/Tiny Baseball/);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.waitForTimeout(1500); // let a few frames render
  expect(errors).toEqual([]);
  expect(externals).toEqual([]);
});

test('E2: both modes reachable from the title screen by click and by key', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-2p').click();
  await expect(page.getByTestId('scoreboard')).toBeVisible();
  expect(await phase(page)).toBe('awaitPitch');
  expect(await page.evaluate(() => (window.__game.state as { mode: string }).mode)).toBe('2p');

  await page.goto('/');
  await page.keyboard.press('1');
  await expect(page.getByTestId('scoreboard')).toBeVisible();
  expect(await page.evaluate(() => (window.__game.state as { mode: string }).mode)).toBe('1p');
});

test('E3: scripted pitch + swing updates the HUD scoreboard', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__game.dispatch({ type: 'start', mode: '2p' });
    window.__game.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
    window.__game.dispatch({ type: 'forceOutcome', outcome: 'homerun' });
  });
  await expect(page.getByTestId('sb-away')).toHaveText('1');
  await expect(page.getByTestId('banner')).toHaveText('HOME RUN!');

  await page.evaluate(() => {
    window.__game.dispatch({ type: 'pitch', pitch: 'curve', lane: 1 });
    window.__game.dispatch({ type: 'cross' });
  });
  await expect(page.getByTestId('sb-strikes')).toHaveText('STK ●○○');
});

test('E4: ffwd reaches game over with a winner; rematch fully resets', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => window.__game.ffwd(123) as { phase: string; winner: string });
  expect(state.phase).toBe('gameOver');
  expect(['away', 'home']).toContain(state.winner);
  await expect(page.getByTestId('gameover')).toBeVisible();
  await expect(page.getByTestId('gameover-text')).toContainText(/(AWAY|HOME) WINS/);

  await page.getByTestId('btn-rematch').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  expect(await phase(page)).toBe('title');
  const scores = await page.evaluate(() => (window.__game.state as { scores: unknown }).scores);
  expect(scores).toEqual({ away: 0, home: 0 });
});

test('E5: M toggles mute and the setting survives a reload', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => (window.__game.state as { muted: boolean }).muted)).toBe(false);
  await page.keyboard.press('m');
  expect(await page.evaluate(() => (window.__game.state as { muted: boolean }).muted)).toBe(true);

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window.__game.state as { muted: boolean }).muted)).toBe(true);

  await page.keyboard.press('m');
  expect(await page.evaluate(() => (window.__game.state as { muted: boolean }).muted)).toBe(false);
});
