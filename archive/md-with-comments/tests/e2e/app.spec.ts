import { test, expect } from './fixtures';
import {
  addComment,
  openDoc,
  readDoc,
  readSidecar,
  removeDoc,
  selectAcross,
  selectText,
  withSave,
  writeDoc,
} from './helpers';

const BASE = `# E2E Fixture Document

Intro paragraph that pads the start of the document with plain words.

First paragraph with a uniquely selectable sentence about anchoring targets.

Second paragraph continues the prose so selections can cross boundaries.

Third paragraph holds a zebra quokka xylophone albatross marker sentence for later removal.

Final paragraph closes the fixture document with a few more words.
`;

const created: string[] = [];

async function makeDoc(name: string, content: string = BASE): Promise<void> {
  created.push(name);
  await removeDoc(name);
  await writeDoc(name, content);
}

test.afterEach(async () => {
  while (created.length > 0) {
    await removeDoc(created.pop()!);
  }
});

test('E1: load app → sample document renders (headings, code block, table visible)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-item').filter({ hasText: 'field-guide.md' }).click();
  const doc = page.locator('[data-testid="doc"]');
  await expect(doc.locator('h1')).toHaveText('The MDComments Field Guide');
  expect(await doc.locator('h2').count()).toBeGreaterThan(5);
  await expect(doc.locator('pre code').first()).toBeVisible();
  await expect(doc.locator('table').first()).toBeVisible();
  await expect(doc.locator('blockquote').first()).toBeVisible();
  await expect(doc.locator('input[type="checkbox"]').first()).toBeAttached();
});

test('E2: select text → Add comment button → submit → highlight in DOM and card in panel', async ({ page }) => {
  await makeDoc('e2e-create.md');
  await openDoc(page, 'e2e-create.md');
  await selectText(page, 'uniquely selectable sentence');
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill('My first comment');
  await page.getByTestId('composer-input').press('Enter');

  const marks = page.locator('[data-testid="doc"] mark.hl');
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText('uniquely selectable sentence');
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('card-body')).toHaveText('My first comment');
});

test('E3: reload page → comment, highlight, and body text persist', async ({ page }) => {
  await makeDoc('e2e-persist.md');
  await openDoc(page, 'e2e-persist.md');
  await withSave(page, () => addComment(page, 'uniquely selectable sentence', 'Persistent comment'));

  await page.reload();
  await expect(page.locator('[data-testid="doc"] h1').first()).toBeVisible();
  const marks = page.locator('[data-testid="doc"] mark.hl');
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText('uniquely selectable sentence');
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('card-body')).toHaveText('Persistent comment');
});

test('E4: reply → thread shows 2 entries; edit reply → updated text shown', async ({ page }) => {
  await makeDoc('e2e-thread.md');
  await openDoc(page, 'e2e-thread.md');
  await addComment(page, 'uniquely selectable sentence', 'Root note');

  const card = page.getByTestId('comment-card');
  await card.getByTestId('reply-btn').click();
  await card.getByTestId('reply-input').fill('First reply');
  await card.getByTestId('submit-reply').click();
  await expect(card.getByTestId('thread-entry')).toHaveCount(2);
  await expect(card.getByTestId('reply-body')).toHaveText('First reply');

  await card.getByTestId('edit-reply').click();
  await card.getByTestId('edit-input').fill('First reply (edited)');
  await card.getByTestId('save-edit').click();
  await expect(card.getByTestId('reply-body')).toHaveText('First reply (edited)');
  await expect(card.getByTestId('thread-entry')).toHaveCount(2);
});

test('E5: resolve → highlight removed, card in Resolved section; reopen → highlight returns', async ({ page }) => {
  await makeDoc('e2e-resolve.md');
  await openDoc(page, 'e2e-resolve.md');
  await addComment(page, 'uniquely selectable sentence', 'Resolve me');
  await expect(page.locator('mark.hl')).toHaveCount(1);

  await page.getByTestId('comment-card').getByTestId('resolve-btn').click();
  await expect(page.locator('mark.hl')).toHaveCount(0);
  const resolvedSection = page.getByTestId('resolved-section');
  await expect(resolvedSection).toBeVisible();
  await expect(resolvedSection.locator('summary')).toHaveText('Resolved (1)');

  await resolvedSection.locator('summary').click();
  const resolvedCard = resolvedSection.getByTestId('comment-card');
  await expect(resolvedCard).toBeVisible();
  await expect(resolvedCard.getByTestId('card-body')).toHaveText('Resolve me');

  await resolvedCard.getByTestId('reopen-btn').click();
  await expect(page.locator('mark.hl')).toHaveCount(1);
  await expect(page.getByTestId('resolved-section')).toHaveCount(0);
});

test('E6: click highlight → card active; click card → document scrolls to highlight', async ({ page }) => {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `Filler paragraph number ${i} with additional words to occupy vertical space in the rendered document.`
  ).join('\n\n');
  await makeDoc('e2e-align.md', `# Long Fixture\n\n${filler}\n\nThe far away target sentence sits deep in the document.\n\nClosing words.\n`);
  await openDoc(page, 'e2e-align.md');
  await addComment(page, 'far away target sentence', 'Deep comment');

  const mark = page.locator('mark.hl').first();
  const card = page.getByTestId('comment-card');

  await page.evaluate(() => window.scrollTo(0, 0));
  await mark.click();
  await expect(card).toHaveClass(/active/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(mark).not.toBeInViewport();
  await card.getByTestId('card-body').click();
  await expect(mark).toBeInViewport();
});

test('E7: comment spanning two paragraphs renders highlights in both', async ({ page }) => {
  await makeDoc('e2e-cross.md');
  await openDoc(page, 'e2e-cross.md');
  await selectAcross(page, 'selectable sentence about anchoring', 'Second paragraph');
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill('Cross-block comment');
  await page.getByTestId('composer-input').press('Enter');

  const firstPara = page.locator('[data-testid="doc"] p', { hasText: 'First paragraph' });
  const secondPara = page.locator('[data-testid="doc"] p', { hasText: 'Second paragraph' });
  await expect(firstPara.locator('mark.hl').first()).toBeVisible();
  await expect(secondPara.locator('mark.hl').first()).toBeVisible();
  expect(await page.locator('mark.hl').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('comment-card').getByTestId('card-body')).toHaveText('Cross-block comment');
});

test('E8: edit-survival — insert paragraph on disk → reload → comment re-anchors to same text', async ({ page }) => {
  const name = 'e2e-survive.md';
  const target = 'uniquely selectable sentence about anchoring';
  await makeDoc(name);
  await openDoc(page, name);
  await withSave(page, () => addComment(page, target, 'Survivor'));

  const before = await readSidecar(name);
  expect(before).not.toBeNull();
  expect(before!.comments).toHaveLength(1);
  expect(before!.comments[0].anchor.exact).toBe(target);

  const md = await readDoc(name);
  await writeDoc(
    name,
    md.replace(
      'Intro paragraph',
      'A freshly inserted paragraph pushes every following block downward.\n\nIntro paragraph'
    )
  );

  await page.reload();
  await expect(page.locator('[data-testid="doc"] h1').first()).toBeVisible();
  const marks = page.locator('[data-testid="doc"] mark.hl');
  await expect(marks.first()).toBeVisible();
  expect((await marks.allTextContents()).join('')).toBe(target);
  await expect(page.getByTestId('orphan-badge')).toHaveCount(0);
});

test('E9: orphan — delete anchored sentence on disk → reload → orphan badge, no highlight', async ({ page }) => {
  const name = 'e2e-orphan.md';
  const target = 'zebra quokka xylophone albatross marker sentence';
  await makeDoc(name);
  await openDoc(page, name);
  await withSave(page, () => addComment(page, target, 'Now homeless'));

  const md = await readDoc(name);
  await writeDoc(
    name,
    md.replace(/Third paragraph holds a zebra[^\n]*/, 'Third paragraph was rewritten without the marker.')
  );

  await page.reload();
  await expect(page.locator('[data-testid="doc"] h1').first()).toBeVisible();
  const card = page.getByTestId('comment-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('card-body')).toHaveText('Now homeless');
  await expect(card.getByTestId('orphan-badge')).toBeVisible();
  await expect(card).toContainText('zebra quokka');
  await expect(page.locator('mark.hl')).toHaveCount(0);
});

test('E10: delete comment (confirm) → highlight and card gone; sidecar has no trace of its id', async ({ page }) => {
  const name = 'e2e-delete.md';
  await makeDoc(name);
  await openDoc(page, name);
  await withSave(page, () => addComment(page, 'uniquely selectable sentence', 'Doomed comment'));

  const before = await readSidecar(name);
  expect(before!.comments).toHaveLength(1);
  const id: string = before!.comments[0].id;
  expect(id).toBeTruthy();

  const card = page.getByTestId('comment-card');
  await card.getByTestId('delete-btn').click();
  await withSave(page, async () => {
    await card.getByTestId('confirm-delete').click();
  });

  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  const after = await readSidecar(name);
  expect(after).not.toBeNull();
  expect(after!.comments).toHaveLength(0);
  expect(JSON.stringify(after)).not.toContain(id);
});
