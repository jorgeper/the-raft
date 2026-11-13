import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const DOCS_DIR = path.resolve(process.cwd(), 'documents');

export async function writeDoc(name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(DOCS_DIR, name), content, 'utf8');
}

export async function readDoc(name: string): Promise<string> {
  return fs.readFile(path.join(DOCS_DIR, name), 'utf8');
}

export async function removeDoc(name: string): Promise<void> {
  await fs.rm(path.join(DOCS_DIR, name), { force: true });
  await fs.rm(path.join(DOCS_DIR, `${name}.comments.json`), { force: true });
}

export async function readSidecar(name: string): Promise<{ comments: any[] } | null> {
  try {
    const raw = await fs.readFile(path.join(DOCS_DIR, `${name}.comments.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function openDoc(page: Page, name: string): Promise<void> {
  await page.goto(`/#doc=${encodeURIComponent(name)}`);
  await expect(page.locator('[data-testid="doc"] h1').first()).toBeVisible();
}

/** Programmatically select `text` (must live inside a single text node). */
export async function selectText(page: Page, text: string): Promise<void> {
  const ok = await page.evaluate((t) => {
    const root = document.querySelector('[data-testid="doc"]');
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue ?? '';
      const i = v.indexOf(t);
      if (i !== -1) {
        n.parentElement?.scrollIntoView({ block: 'center' });
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    }
    return false;
  }, text);
  expect(ok, `text "${text}" should be selectable in the document`).toBe(true);
}

/** Select from the start of `startText` through the end of `endText` (later node). */
export async function selectAcross(page: Page, startText: string, endText: string): Promise<void> {
  const ok = await page.evaluate(
    ([s, e]) => {
      const root = document.querySelector('[data-testid="doc"]');
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let startNode: Node | null = null;
      let startIdx = -1;
      let endNode: Node | null = null;
      let endIdx = -1;
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue ?? '';
        if (!startNode) {
          const i = v.indexOf(s);
          if (i !== -1) {
            startNode = n;
            startIdx = i;
          }
        } else {
          const j = v.indexOf(e);
          if (j !== -1) {
            endNode = n;
            endIdx = j + e.length;
            break;
          }
        }
      }
      if (!startNode || !endNode) return false;
      startNode.parentElement?.scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(startNode, startIdx);
      r.setEnd(endNode, endIdx);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    },
    [startText, endText] as const
  );
  expect(ok, `range "${startText}" → "${endText}" should be selectable`).toBe(true);
}

/** Create a comment on the given selected text via the real UI affordances. */
export async function addComment(page: Page, selectedText: string, body: string): Promise<void> {
  await selectText(page, selectedText);
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill(body);
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.getByTestId('comment-card').filter({ hasText: body }).first()).toBeVisible();
}

/** Run an action and wait until the sidecar PUT autosave completes. */
export async function withSave(page: Page, action: () => Promise<void>): Promise<void> {
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/comments'),
    { timeout: 10_000 }
  );
  await action();
  await saved;
}
