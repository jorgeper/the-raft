# SPEC: Markdown Commenting App ("MDComments")

A local web app that loads a Markdown file, renders it, and provides a Microsoft Word–style
commenting experience on top of it. This spec is written to be executed autonomously by
Claude Code using `/goal`. Read the whole file before writing any code. The Definition of
Done in §8 is the goal condition — every item must be provable in the transcript via the
validation harness in §7.

---

## 1. Overview

The user opens the app in a browser, loads a `.md` file, sees it rendered as HTML, selects
any text in the rendered document, and attaches a comment. Comments appear as highlights in
the document and as cards in a right-hand margin panel, aligned with their anchors. Comments
support threaded replies, editing, deletion, and resolve/reopen. All comments persist to a
sidecar JSON file (Web Annotation–style anchors) and survive page reloads and light edits to
the underlying markdown.

## 2. Tech stack (fixed — do not substitute)

- **Frontend:** React + TypeScript, built with Vite.
- **Markdown rendering:** `unified` / `remark` / `rehype` pipeline (or `markdown-it` if
  position mapping proves easier — document the choice in `ARCHITECTURE.md`). The renderer
  MUST preserve a mapping from rendered DOM text back to source offsets, OR anchoring must
  be done against the rendered plain text (choose one, document it, and be consistent).
- **Backend:** Node.js + Express (or Fastify). Serves the SPA, exposes a small REST API for
  reading markdown files and reading/writing sidecar comment files. No database — the
  filesystem is the store.
- **Fuzzy re-anchoring:** `diff-match-patch` npm package.
- **E2E tests:** Playwright (`@playwright/test`), headless Chromium.
- **Unit tests:** Vitest.
- **No authentication, no multi-user sync, no CRDTs.** Single local user.

## 3. Functional requirements

### FR-1: File loading
1. App shows a file picker listing `.md` files in the server's `./documents/` directory
   (API: `GET /api/files`).
2. Selecting a file loads and renders it (`GET /api/files/:name`).
3. Ship at least two sample documents in `./documents/`, one of which is ≥ 2,000 words with
   headings, lists, code blocks, blockquotes, and links (needed for scroll/alignment tests).

### FR-2: Rendering
1. Markdown renders to sanitized HTML (use `rehype-sanitize` or equivalent — no raw script
   execution from documents).
2. GitHub-flavored markdown: tables, task lists, strikethrough, fenced code blocks.

### FR-3: Creating comments
1. Selecting a non-empty text range in the rendered document shows a floating "Add comment"
   button near the selection (like Word's context affordance).
2. Clicking it opens a comment composer in the margin panel; Enter/submit creates the
   comment; Escape cancels.
3. The commented range gets a persistent highlight (background tint). Overlapping comment
   ranges must both render (darker tint where they overlap is acceptable).
4. Selections that span multiple block elements (e.g., end of one paragraph into the next)
   must work.
5. Comments store: unique id, author (single hardcoded/local-configurable name is fine),
   ISO timestamp, body text, resolved flag, thread array.

### FR-4: Anchoring model (the core of this app)
Each comment stores a redundant anchor against the document's plain text:
```json
{
  "exact": "the selected text",
  "prefix": "32 chars before",
  "suffix": "32 chars after",
  "start": 1042,
  "end": 1061
}
```
Re-anchoring on document load follows this cascade, in order:
1. Exact match at stored offsets.
2. Unique quote search using exact + prefix/suffix to disambiguate.
3. Fuzzy match via diff-match-patch (`match_main`), threshold documented in code.
4. Failure → comment becomes **orphaned**: no highlight, but its card still shows in the
   panel with the original quoted text and an "orphaned" badge.

### FR-5: Margin panel (Word-like UX)
1. Right-hand panel shows comment cards vertically, ordered by anchor position, roughly
   aligned with their highlights; cards may push each other down to avoid overlap.
2. Clicking a highlight scrolls/focuses its card and visually activates both (and vice
   versa: clicking a card scrolls to and flashes the highlight).
3. Cards show author, relative timestamp, body, thread replies, and controls: Reply, Edit,
   Delete, Resolve/Reopen.
4. Resolved comments: highlight disappears from the document; card moves under a collapsed
   "Resolved (N)" section; Reopen restores the highlight.
5. A toggle hides/shows all comments (like Word's "Show Comments").

### FR-6: Threads
1. Reply adds an entry to the comment's thread with its own author/timestamp/body.
2. Replies can be edited and deleted. Deleting the root comment deletes the whole thread
   (with a confirm step).

### FR-7: Persistence
1. Comments for `documents/foo.md` persist to `documents/foo.md.comments.json` via
   `PUT /api/files/:name/comments` (debounced autosave ≤ 2s after any change).
2. The JSON format must match the anchor schema above and be pretty-printed (git-diffable).
3. Reloading the page restores all comments, highlights, resolved state, and threads.

### FR-8: Surviving edits
1. If the markdown file changes on disk between sessions (text inserted/removed elsewhere in
   the document), previously created comments re-anchor correctly via the FR-4 cascade.
2. If the anchored text itself was deleted, the comment shows as orphaned (not crashed, not
   silently dropped).

## 4. Non-functional requirements

- `npm install && npm run dev` starts everything (single command, concurrently is fine).
- `npm run build` produces a production build with zero TypeScript errors.
- No console errors during any E2E test run.
- Code is organized with the anchoring logic in a pure, unit-testable module
  (`src/lib/anchoring.ts`) with no DOM dependencies.

## 5. Project structure (target)

```
mdcomments/
  SPEC.md                  (this file)
  ARCHITECTURE.md          (written by you: decisions, anchor coordinate space, tradeoffs)
  package.json             (workspace root; scripts: dev, build, test, test:unit, test:e2e, validate)
  server/                  (Express/Fastify API)
  src/                     (React app)
    lib/anchoring.ts       (pure anchoring + re-anchoring logic)
  documents/               (sample markdown + sidecar comment files)
  tests/
    unit/                  (Vitest: anchoring cascade, orphaning, offsets)
    e2e/                   (Playwright: the acceptance tests in §7)
```

## 6. Build order (follow this sequence)

1. Scaffold repo, server, Vite app; get `npm run dev` serving a rendered sample document.
2. Write `src/lib/anchoring.ts` **with its unit tests first** (TDD for the cascade).
3. Implement selection → composer → highlight → margin card (FR-3, FR-5 basics).
4. Persistence (FR-7), then threads/resolve/edit/delete (FR-5, FR-6).
5. Re-anchoring on load + orphaning (FR-8).
6. Write all Playwright tests in §7, make them pass, then run the full validation.

## 7. Validation harness (MUST exist exactly as specified)

Create `npm run validate` that runs, in order, and fails on the first non-zero exit:
1. `tsc --noEmit` (zero type errors)
2. `npm run test:unit` — Vitest, must include at minimum:
   - U1: exact-offset re-anchor succeeds after no edit
   - U2: quote-search re-anchor succeeds after text inserted before the anchor
   - U3: prefix/suffix disambiguates when `exact` appears 3+ times in the document
   - U4: fuzzy re-anchor succeeds after a 1–2 character typo edit inside the anchored text
   - U5: orphaning triggers when the anchored text is fully deleted
3. `npm run test:e2e` — Playwright headless, must include at minimum:
   - E1: load app → sample document renders (headings, code block, table visible)
   - E2: select text → Add comment button appears → submit → highlight exists in DOM and
     card appears in panel with correct body text
   - E3: reload page → comment, highlight, and body text persist
   - E4: reply to a comment → thread shows 2 entries; edit reply → updated text shown
   - E5: resolve → highlight removed from document, card in Resolved section; reopen →
     highlight returns
   - E6: click highlight → its card gets the active state; click card → document scrolls to
     highlight
   - E7: comment spanning two paragraphs renders highlights in both
   - E8: **edit-survival test:** via API/fs, insert a paragraph near the top of the document
     after comments exist → reload → comment re-anchors to the same text (assert the
     highlighted string equals the original `exact`)
   - E9: **orphan test:** via API/fs, delete the anchored sentence → reload → comment card
     shows orphaned badge, no highlight, app has no console errors
   - E10: delete a comment (confirm) → highlight and card gone; sidecar JSON no longer
     contains its id
4. Print `VALIDATION: ALL PASSED` as the final line only if steps 1–3 all exited 0.

**Anti-gaming constraints (binding):**
- Tests must make real assertions against the running app; no test may be skipped, stubbed,
  marked `.skip`/`.todo`, or have its assertions weakened to pass.
- Do not hardcode expected outputs in app code to satisfy a test.
- If a requirement in §3 turns out to be genuinely infeasible, do NOT silently drop it —
  write the blocker into `BLOCKERS.md` with an explanation, and keep everything else green.

## 8. Definition of Done (the /goal condition verifies exactly this)

All of the following are demonstrated in the transcript:
1. `npm run build` exits 0.
2. `npm run validate` exits 0 and its full output — including every named test U1–U5 and
   E1–E10 passing and the final `VALIDATION: ALL PASSED` line — is printed to the
   transcript in the same turn that claims completion.
3. All tests listed in §7 exist under `tests/` with real assertions (show
   `grep -rc "test(" tests/` or equivalent evidence).
4. `ARCHITECTURE.md` exists and states the anchoring coordinate space decision.
5. No `.skip`, `.only`, `.todo`, or commented-out assertions in `tests/`
   (prove with `grep -rn "\.skip\|\.only\|\.todo" tests/` returning nothing).

---

## 9. How to launch the overnight run

From an empty directory containing only this SPEC.md, with auto/permissive mode enabled so
tool calls don't block overnight:

```bash
claude -p "/goal Implement SPEC.md in full. Done when: 'npm run build' exits 0 AND 'npm run validate' exits 0 with its complete output (unit tests U1–U5, e2e tests E1–E10, and the final line 'VALIDATION: ALL PASSED') printed in the transcript, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND ARCHITECTURE.md exists. Constraints: SPEC.md and this condition must not be modified; tests must contain real assertions per SPEC.md §7 and may not be weakened, stubbed, or deleted to pass; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work."
```

Notes:
- `/goal` requires Claude Code v2.1.139+, an accepted workspace trust dialog, and hooks
  enabled.
- The evaluator only judges what appears in the transcript, which is why §8 requires the
  full `npm run validate` output to be printed, not just claimed.
- The turn/time cap is a safety valve for an unattended run; on the next session, re-issue
  the same goal to resume if it hit the cap.
