import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const WELCOME = '/docs/welcome.md';
export const WELCOME_SIDECAR = '/docs/welcome.md.comments.json';

/** Fresh app: wipe the shim fs (localStorage) and load the welcome doc. */
export async function freshApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
}

/** Open the Settings panel through the v2 overflow menu. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-panel').waitFor();
}

export function fsRead(page: Page, path: string): Promise<string | null> {
  return page.evaluate((p) => window.__mmfs!.read(p), path);
}

export function fsWrite(page: Page, path: string, content: string): Promise<void> {
  return page.evaluate(([p, c]) => window.__mmfs!.write(p, c), [path, content] as const);
}

/** Select `phrase` (must live inside a single text node) in the rendered doc. */
export async function selectPhrase(page: Page, phrase: string): Promise<void> {
  await page.evaluate((needle) => {
    const doc = document.querySelector('[data-testid="doc"]');
    if (!doc) throw new Error('doc not rendered');
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue?.indexOf(needle) ?? -1;
      if (idx !== -1) {
        // Scroll first so the floating Add-comment button lands in-viewport.
        node.parentElement?.scrollIntoView({ block: 'center' });
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error(`phrase not found in doc: ${needle}`);
  }, phrase);
}

/** Select from `phraseA` through `phraseB` (start of A to end of B), spanning blocks. */
export async function selectSpan(page: Page, phraseA: string, phraseB: string): Promise<void> {
  await page.evaluate(([a, b]) => {
    const doc = document.querySelector('[data-testid="doc"]');
    if (!doc) throw new Error('doc not rendered');
    const find = (needle: string) => {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1;
        if (idx !== -1) return { node, idx };
      }
      throw new Error(`phrase not found in doc: ${needle}`);
    };
    const startHit = find(a);
    const endHit = find(b);
    startHit.node.parentElement?.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(startHit.node, startHit.idx);
    range.setEnd(endHit.node, endHit.idx + b.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, [phraseA, phraseB] as const);
}

/** Full comment flow: select, click the floating button, type, submit. */
export async function addComment(page: Page, phrase: string, body: string): Promise<void> {
  await selectPhrase(page, phrase);
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill(body);
  await page.getByTestId('composer-submit').click();
}

/** Wait until the autosaved sidecar (debounced 800 ms) satisfies `predicate`. */
export async function waitForSidecar(
  page: Page,
  predicate: (content: string | null) => boolean
): Promise<void> {
  await expect
    .poll(async () => predicate(await fsRead(page, WELCOME_SIDECAR)), { timeout: 5000 })
    .toBe(true);
}
