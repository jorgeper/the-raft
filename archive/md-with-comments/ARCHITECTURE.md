# MDComments — Architecture

## Overview

MDComments is a local, single-user Markdown reviewing tool: an Express API that
reads/writes files under `documents/`, and a Vite + React + TypeScript SPA that
renders a document and layers a Word-style commenting experience on top of it.
There is no database — each document `foo.md` gets a pretty-printed sidecar
`foo.md.comments.json` next to it.

```
browser (React SPA) ──/api proxy──▶ Express (server/index.ts)
     │                                   │
     │  unified render + DOM highlights  │  documents/*.md
     └── src/lib/anchoring.ts (pure)     └── documents/*.md.comments.json
```

## Anchor coordinate space (the key decision)

**Anchors are expressed as character offsets into the rendered plain text of
the document** — the concatenation of every DOM text node under the document
container, in tree order. They are *not* offsets into the markdown source.

Why this space:

- It is exactly what the user selects. A `Range` in the rendered DOM converts
  to offsets losslessly with the classic pre-range trick
  (`Range.toString().length`, see `src/lib/domtext.ts`), and back again by
  walking text nodes. No source-position mapping through the markdown pipeline
  is needed, which keeps the renderer swappable.
- It is deterministic: the same markdown always renders to the same HTML and
  therefore the same plain text, so anchors are stable across reloads.
- The re-anchoring cascade only needs *one* string to search. On every load we
  re-render the (possibly edited) markdown, extract the fresh plain text, and
  re-run the cascade against it.

The tradeoff: anchors are coupled to the renderer's text output. Changing the
markdown pipeline (e.g. different whitespace between blocks) can shift offsets.
That is acceptable because the cascade's quote and fuzzy steps recover from
shifts, and the renderer is pinned in this repo.

## Rendering pipeline

`unified` → `remark-parse` → `remark-gfm` → `remark-rehype` →
`rehype-sanitize` (GitHub schema, extended to keep task-list checkboxes) →
`rehype-stringify` (`src/lib/markdown.ts`). The sanitizer means documents can
never execute script. The resulting HTML string is written into a
React-managed-but-imperatively-filled `<div>`; React never reconciles inside
it, so the app can freely split text nodes to insert highlight `<mark>`s.

## Anchoring model (`src/lib/anchoring.ts`, pure, no DOM)

Each comment stores a redundant anchor: `exact`, 32-char `prefix`/`suffix`,
and `start`/`end` offsets. Re-anchoring cascade (FR-4):

1. **Exact-at-offset** — `text.slice(start, end) === exact`.
2. **Quote search** — find all occurrences of `exact`; a unique hit wins; with
   multiple hits, the occurrence whose surrounding text shares the longest
   common suffix/prefix with the stored `prefix`/`suffix` wins (ties break to
   the occurrence nearest the stored offset).
3. **Fuzzy** — `diff-match-patch` `match_main`, threshold **0.4**, distance
   5000. Bitap limits patterns to 32 chars, so longer selections match their
   first and last 32 chars independently and stitch the range (with a sanity
   check that the stitched length is within 0.5×–2× the original).
4. **Orphaned** — the comment keeps its card (badge + original quote) but has
   no highlight. Nothing is deleted.

After a successful re-anchor the stored anchor is refreshed from the new text
and autosaved, so anchors continuously track the document.

## Highlights and the margin panel

- `highlightRange` (`src/lib/domtext.ts`) splits text nodes at range
  boundaries and wraps each intersected segment in
  `<mark class="hl" data-cid=…>`. Multi-block selections produce one mark per
  text node; whitespace-only segments are skipped. Overlapping comments nest
  marks, and nested marks render darker via CSS stacking.
- The panel lays cards out in flow order (sorted by re-anchored position) and
  a layout pass sets each card's `margin-top` so it sits level with its first
  highlight, pushing later cards down to avoid overlap — the Word behavior.
- Click a highlight → its card activates and scrolls into view; click a card →
  the document scrolls to the highlight and flashes it. Resolved comments lose
  their highlights and collapse into a `Resolved (N)` section; a toolbar
  toggle hides all commenting UI.

## Persistence

All comment state lives in React; any change debounces (800 ms, well under
the 2 s budget) into `PUT /api/files/:name/comments`. The server writes
pretty-printed JSON so sidecars diff cleanly in git. Reload restores comments,
threads, resolved state, and re-runs the cascade.

## Testing

- **Vitest** (`tests/unit/`) covers the pure cascade: U1 exact, U2 quote after
  insertion, U3 prefix/suffix disambiguation among 3+ duplicates, U4 fuzzy
  after in-anchor typos, U5 orphaning after deletion.
- **Playwright** (`tests/e2e/`) drives the real app headlessly (E1–E10),
  including on-disk edits between reloads for edit-survival and orphaning. A
  shared fixture fails any test that produces a browser console error.
- `npm run validate` = typecheck → unit → e2e → `VALIDATION: ALL PASSED`.
