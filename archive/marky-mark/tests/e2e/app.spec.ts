import { expect, test } from './fixtures';
import {
  addComment,
  freshApp,
  fsRead,
  fsWrite,
  openSettings,
  selectPhrase,
  selectSpan,
  waitForSidecar,
  WELCOME,
  WELCOME_SIDECAR,
} from './helpers';

// A phrase from fixtures/welcome.md that lives inside one paragraph.
const PHRASE = 'saved to a sidecar file next to the document';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E1: launch → welcome document renders headings, code block, and table', async ({ page }) => {
  const doc = page.getByTestId('doc');
  await expect(doc.locator('h1')).toContainText('Welcome to Markimark');
  await expect(doc.locator('pre code')).toBeVisible();
  await expect(doc.locator('table')).toBeVisible();
  await expect(doc.locator('table')).toContainText('Switch theme');
  await expect(doc.locator('input[type="checkbox"]').first()).toBeVisible();
});

test('E2: Settings lists the 7 built-in themes; Monokai changes the background; choice persists across reload', async ({
  page,
}) => {
  await openSettings(page);
  const select = page.getByTestId('settings-theme-light');
  for (const id of ['crisp', 'claude', 'monokai', 'dracula', 'nord', 'solarized-light', 'one-dark']) {
    await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
  }

  const before = await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(before).toBe('rgb(255, 255, 255)'); // Crisp default

  await select.selectOption('monokai');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)'); // Monokai #272822
  await page.getByTestId('settings-close').click();

  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-light')).toHaveValue('monokai');
});

test('E3: dropping a user theme into the config themes dir + Reload themes (in Settings) makes it appear and apply', async ({
  page,
}) => {
  const css = `/* @name: Midnight Ocean\n   @author: e2e\n   @variant: dark */\n.theme-root { --mm-bg: #010203; --mm-fg: #d8e2ec; }`;
  await fsWrite(page, '/config/themes/midnight-ocean.css', css);

  await openSettings(page);
  await page.getByTestId('reload-themes').click();
  const select = page.getByTestId('settings-theme-light');
  const option = select.locator('option[value="midnight-ocean"]');
  await expect(option).toHaveCount(1);
  await expect(option).toHaveText(/Midnight Ocean/);
  await select.selectOption('midnight-ocean');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(1, 2, 3)');
});

test('E4: hotkey toggles into edit mode showing markdown source; editing reflects in preview after toggling back', async ({
  page,
}) => {
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toContainText('# Welcome to Markimark');
  await expect(page.getByTestId('doc')).toHaveCount(0); // swap, never side-by-side

  // Click the first line (the H1) so the typed text lands in rendered output,
  // not in a non-rendering spot like a table delimiter or fence info string.
  await editor.locator('.cm-line').first().click();
  await page.keyboard.type('EDITMARK ');

  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('doc')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toContainText('EDITMARK');
});

test('E5: Cmd/Ctrl+S in edit mode persists the buffer to disk and clears the dirty indicator', async ({ page }) => {
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('SAVEMARK ');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const onDisk = await fsRead(page, WELCOME);
  expect(onDisk).toContain('SAVEMARK');
});

test('E6: remapping the edit-toggle hotkey in settings takes effect immediately; the old combo stops working', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('hotkey-toggleEdit').click();
  await page.keyboard.press('Control+Shift+E');
  await page.getByTestId('settings-close').click();

  await page.keyboard.press('Control+e'); // old combo — must do nothing
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('doc')).toBeVisible();

  await page.keyboard.press('Control+Shift+E'); // new combo
  await expect(page.getByTestId('editor')).toBeVisible();

  // Persisted to settings.json in the config dir.
  const settings = await fsRead(page, '/config/settings.json');
  expect(settings).toContain('Mod+Shift+E');
});

test('E7: select text → Add comment → highlight in DOM and card in panel with the body text', async ({ page }) => {
  await selectPhrase(page, PHRASE);
  await expect(page.getByTestId('add-comment-btn')).toBeVisible();
  await page.getByTestId('add-comment-btn').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer-input').fill('First note');
  await page.getByTestId('composer-submit').click();

  const mark = page.locator('mark.hl');
  await expect(mark.first()).toBeVisible();
  await expect(mark.first()).toContainText('saved to a sidecar file');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('First note');
});

test('E8: comments, highlights, and thread state persist across reload via the sidecar', async ({ page }) => {
  await addComment(page, PHRASE, 'Persistent note');
  await waitForSidecar(page, (s) => !!s && s.includes('Persistent note'));

  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('card-body')).toHaveText('Persistent note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  const sidecar = await fsRead(page, WELCOME_SIDECAR);
  expect(sidecar).toContain('"exact"');
  expect(sidecar).toContain('"prefix"');
  expect(sidecar).toContain('"suffix"');
});

test('E9: reply, edit reply, resolve (highlight gone, card in Resolved), reopen (highlight returns)', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Root comment');

  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('A reply');
  await page.getByTestId('submit-reply').click();
  await expect(page.getByTestId('thread-entry')).toHaveCount(2);
  await expect(page.getByTestId('reply-body')).toHaveText('A reply');

  await page.getByTestId('edit-reply').click();
  await page.getByTestId('edit-input').fill('An edited reply');
  await page.getByTestId('save-edit').click();
  await expect(page.getByTestId('reply-body')).toHaveText('An edited reply');

  await page.getByTestId('resolve-btn').click();
  await expect(page.locator('mark.hl')).toHaveCount(0);
  const resolvedSection = page.getByTestId('resolved-section');
  await expect(resolvedSection).toContainText('Resolved (1)');
  await resolvedSection.locator('summary').click();
  await expect(resolvedSection.getByTestId('comment-card')).toHaveCount(1);

  await resolvedSection.getByTestId('reopen-btn').click();
  await expect(page.locator('mark.hl').first()).toBeVisible();
});

test('E10: a comment spanning two blocks highlights in both; deleting it (confirmed) removes card and sidecar entry', async ({
  page,
}) => {
  // From inside the "Reading" paragraph into the blockquote further down.
  await selectSpan(page, 'GitHub-flavored markdown', 'A task list');
  await page.getByTestId('add-comment-btn').click();
  await page.getByTestId('composer-input').fill('Spanning comment');
  await page.getByTestId('composer-submit').click();

  const markCount = await page.locator('mark.hl').count();
  expect(markCount).toBeGreaterThanOrEqual(2);
  await waitForSidecar(page, (s) => !!s && s.includes('Spanning comment'));

  await page.getByTestId('delete-btn').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('comment-card')).toHaveCount(0);
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // Last comment deleted → the sidecar file itself is removed.
  await waitForSidecar(page, (s) => s === null);
});

test('E11: edit-survival — inserting a paragraph near the top re-anchors the comment to the same text', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Survivor');
  await waitForSidecar(page, (s) => !!s && s.includes('Survivor'));

  const md = (await fsRead(page, WELCOME))!;
  const edited = md.replace(
    '## Reading',
    'A freshly inserted paragraph that shifts every offset in this document by a good amount.\n\n## Reading'
  );
  expect(edited).not.toBe(md);
  await fsWrite(page, WELCOME, edited);

  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  const highlighted = await page.locator('mark.hl').allTextContents();
  expect(highlighted.join('')).toBe(PHRASE);
  await expect(page.getByTestId('orphan-badge')).toHaveCount(0);
});

test('E12: orphan — deleting the anchored sentence yields an orphan badge, no highlight, no console errors', async ({
  page,
}) => {
  await addComment(page, PHRASE, 'Orphan-to-be');
  await waitForSidecar(page, (s) => !!s && s.includes('Orphan-to-be'));

  const md = (await fsRead(page, WELCOME))!;
  const sentence =
    'Your note is saved to a sidecar file next to the document (`welcome.md.comments.json`), so the markdown itself stays untouched.';
  expect(md).toContain(sentence);
  await fsWrite(page, WELCOME, md.replace(sentence, ''));

  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
  await expect(page.getByTestId('comment-card')).toHaveCount(1);
  await expect(page.getByTestId('orphan-badge')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toContainText('Orphan-to-be');
  await expect(page.locator('mark.hl')).toHaveCount(0);
  // consoleGuard fixture asserts zero console errors at teardown.
});

test('E13: toolbar is minimal — one overflow menu with exactly Open/Save/Save As/Settings; menu Save persists', async ({
  page,
}) => {
  // Old toolbar buttons are gone.
  await expect(page.getByTestId('theme-picker')).toHaveCount(0);
  await expect(page.getByTestId('open-file')).toHaveCount(0);
  await expect(page.getByTestId('settings-btn')).toHaveCount(0);

  await page.getByTestId('menu-btn').click();
  const menu = page.getByTestId('app-menu');
  await expect(menu.getByTestId('menu-open')).toBeVisible();
  await expect(menu.getByTestId('menu-save')).toBeVisible();
  await expect(menu.getByTestId('menu-save-as')).toBeVisible();
  await expect(menu.getByTestId('menu-settings')).toBeVisible();
  await expect(menu.locator('button')).toHaveCount(4); // exactly these four (SPEC3 §3.3)
  await page.keyboard.press('Escape');
  await page.getByTestId('docname').click(); // close menu

  // Dirty the buffer, then save via the menu.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('MENUSAVE ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  expect(await fsRead(page, WELCOME)).toContain('MENUSAVE');
});

test('E14: hovering the filename reveals the full on-disk path (title attribute)', async ({ page }) => {
  await expect(page.getByTestId('docname')).toHaveAttribute('title', WELCOME);
  await expect(page.getByTestId('docname')).toContainText('welcome.md');
});

test('E15: embedded mode — comments autosave into an invisible trailer, sidecar removed, reload restores', async ({
  page,
}) => {
  // Seed a sidecar first so the migration (sidecar → embedded) is exercised.
  await addComment(page, PHRASE, 'Embedded note');
  await waitForSidecar(page, (s) => !!s && s.includes('Embedded note'));

  await openSettings(page);
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Any comment change triggers the embedded autosave + sidecar cleanup.
  await page.getByTestId('reply-btn').click();
  await page.getByTestId('reply-input').fill('embedded reply');
  await page.getByTestId('submit-reply').click();

  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('markimark-comments')).toBe(true);
  await expect.poll(async () => fsRead(page, WELCOME_SIDECAR), { timeout: 5000 }).toBe(null);
  const onDisk = (await fsRead(page, WELCOME))!;
  expect(onDisk).toContain('Embedded note');
  expect(onDisk.trimEnd().endsWith('-->')).toBe(true);

  await page.reload();
  await expect(page.getByTestId('doc').locator('h1')).toContainText('Welcome to Markimark');
  await expect(page.getByTestId('card-body')).toHaveText('Embedded note');
  await expect(page.locator('mark.hl').first()).toBeVisible();

  // The trailer is invisible everywhere: preview text and edit buffer.
  await expect(page.getByTestId('doc')).not.toContainText('markimark-comments');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).not.toContainText('markimark-comments');
});

test('E16: embedded autosave never flushes unsaved text edits; explicit save writes both', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('comment-storage').selectOption('embedded');
  await page.getByTestId('settings-close').click();

  // Dirty the buffer without saving.
  await page.keyboard.press('Control+e');
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('DIRTYMARK ');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();

  // Comment autosave rewrites the file from the LAST SAVED text.
  await addComment(page, PHRASE, 'while dirty');
  await expect.poll(async () => (await fsRead(page, WELCOME))?.includes('markimark-comments')).toBe(true);
  const afterAutosave = (await fsRead(page, WELCOME))!;
  expect(afterAutosave).not.toContain('DIRTYMARK');
  expect(afterAutosave).toContain('while dirty');
  await expect(page.getByTestId('dirty-dot')).toBeVisible(); // still dirty

  // Explicit save writes buffer + trailer together.
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  const afterSave = (await fsRead(page, WELCOME))!;
  expect(afterSave).toContain('DIRTYMARK');
  expect(afterSave).toContain('markimark-comments');
  expect(afterSave).toContain('while dirty');
});

test('E17: hamburger and outline-balloon SVG icons replace the glyph/emoji', async ({ page }) => {
  const menuBtn = page.getByTestId('menu-btn');
  await expect(menuBtn.getByTestId('menu-icon')).toBeVisible();
  expect(await menuBtn.evaluate((el) => el.querySelector('svg') !== null)).toBe(true);
  expect(await menuBtn.textContent()).not.toContain('⋯');

  const commentsBtn = page.getByTestId('comments-toggle');
  await expect(commentsBtn.getByTestId('comments-icon')).toBeVisible();
  expect(await commentsBtn.evaluate((el) => el.querySelector('svg') !== null)).toBe(true);
  expect(await commentsBtn.textContent()).not.toContain('💬');
  // The balloon is an outline: stroked, unfilled path.
  const path = commentsBtn.locator('svg path');
  await expect(path).toHaveAttribute('fill', 'none');
  await expect(path).toHaveAttribute('stroke', 'currentColor');
});

test('E18: Save As writes the buffer (and sidecar) to the chosen path and switches to it', async ({ page }) => {
  await addComment(page, PHRASE, 'travels along');
  await waitForSidecar(page, (s) => !!s && s.includes('travels along'));

  await page.evaluate(() => {
    window.__mmfs!.nextSavePath = '/docs/copy.md';
  });
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-save-as').click();

  await expect(page.getByTestId('docname')).toContainText('copy.md');
  await expect(page.getByTestId('docname')).toHaveAttribute('title', '/docs/copy.md');
  const copied = await fsRead(page, '/docs/copy.md');
  expect(copied).toContain('# Welcome to Markimark');
  // Sidecar mode: comments were written next to the NEW file and still show.
  const sidecar = await fsRead(page, '/docs/copy.md.comments.json');
  expect(sidecar).toContain('travels along');
  await expect(page.getByTestId('card-body')).toHaveText('travels along');
});

test('E19: customized font size applies to the document; Auto restores the theme default', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('fontsize-custom').check();
  await page.getByTestId('fontsize-input').fill('20');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('20px');

  await page.getByTestId('fontsize-auto').check();
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px'); // Crisp's --mm-font-size
});

test('E20: zoom select applies CSS zoom to the app root; Reset to Default restores 100%', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('zoom-select').selectOption('150');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).zoom))
    .toBe('1.5');

  await page.getByTestId('zoom-reset').click();
  await expect(page.getByTestId('zoom-select')).toHaveValue('100');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).zoom))
    .toBe('1');
});

test('E21: light/dark theme pair follows the OS scheme; unchecking uses the light theme everywhere', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await page.getByTestId('settings-close').click();

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)'); // Crisp

  // Uncheck "Use separate theme in dark mode" → dark scheme keeps the light theme.
  await openSettings(page);
  await page.getByTestId('use-dark-theme').uncheck();
  await page.getByTestId('settings-close').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
});

test('E22: Wide text margins narrow the column; line numbers gutter follows its setting', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('wide');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('608px'); // 38rem
  await page.getByTestId('settings-close').click();

  // Default: gutter present.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toBeVisible();
  await page.keyboard.press('Control+e');

  await openSettings(page);
  await page.getByTestId('settings-line-numbers').uncheck();
  await page.getByTestId('settings-close').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toHaveCount(0);
});

test('E23: vim navigation — off by default, full motion set when enabled, never fires while typing', async ({
  page,
}) => {
  const scrollTop = () => page.locator('.workspace').evaluate((el) => el.scrollTop);

  // Disabled (default): j does nothing.
  await page.getByTestId('docname').click();
  await page.keyboard.press('j');
  await page.waitForTimeout(150);
  expect(await scrollTop()).toBe(0);

  await openSettings(page);
  await page.getByTestId('settings-vimnav').check();
  await page.getByTestId('settings-close').click();

  // j scrolls down, k back up.
  await page.keyboard.press('j');
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const afterJ = await scrollTop();
  await page.keyboard.press('k');
  await expect.poll(scrollTop).toBeLessThan(afterJ);

  // Ctrl+d jumps about half a viewport; gg returns to top; G reaches bottom.
  await page.keyboard.press('Control+d');
  const viewport = await page.locator('.workspace').evaluate((el) => el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(viewport / 2 - 80);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await page.keyboard.press('Shift+G');
  const max = await page.locator('.workspace').evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(scrollTop).toBeGreaterThanOrEqual(max - 2);

  // Typing j into the composer inserts a "j" and does not scroll.
  await page.keyboard.press('g'); // reset: gg to top
  await page.keyboard.press('g');
  await expect.poll(scrollTop).toBe(0);
  await selectPhrase(page, PHRASE);
  await page.getByTestId('add-comment-btn').click();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  // Bring the composer on-screen first — otherwise Chromium scrolls the
  // focused textarea into view on the first keystroke (unrelated to vim nav).
  await page.getByTestId('composer-input').scrollIntoViewIfNeeded();
  // Let the composer autofocus/card-alignment scrolling settle, then measure.
  await expect
    .poll(async () => {
      const a = await scrollTop();
      await page.waitForTimeout(120);
      return (await scrollTop()) - a;
    })
    .toBe(0);
  const composerScroll = await scrollTop();
  await page.getByTestId('composer-input').pressSequentially('jjj');
  await expect(page.getByTestId('composer-input')).toHaveValue('jjj');
  expect(await scrollTop()).toBe(composerScroll);
});

test('E24: the new Claude theme — Typora-derived paper, serif body, tight headings, 752px column', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('claude');
  await page.getByTestId('settings-close').click();

  const doc = page.getByTestId('doc');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(250, 249, 245)'); // #faf9f5 paper
  expect(await doc.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia'); // serif body stack
  await expect.poll(() => doc.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('752px'); // 47rem column
  expect(await doc.locator('h1').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px'); // 1.375rem
});
