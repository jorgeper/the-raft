---
name: wiki
description: >-
  Generate or update the browsable "wiki" for the user's Obsidian vault — one markdown page
  per chosen tag/area under wiki/, each stacking compressed summaries of every raw note with
  that tag, newest first, with backlinks to the originals. Use when they say "update the
  wiki", "build the wiki for llm, data", "regenerate my area pages", or similar. Incremental:
  only re-summarizes new or changed notes. Writes only under wiki/ — never edits raw/,
  manual/, or ai/.
---

# Second Brain — build/update the area wiki

Produce one page per selected tag at `<vault>/wiki/<tag>.md`, each stacking compressed
summaries of the raw notes carrying that tag, **newest date first**, with a backlink to each
original.

Write **only** under `<vault>/wiki/` — the tag pages and the state file. Read `raw/` but never
modify it. Never touch `manual/` or `ai/`. Full format spec:
`${CLAUDE_PLUGIN_ROOT}/reference/wiki-page-format.md`.

## Step 1 — Resolve the vault
Same as capture: a path/name in the request → walk up from the current directory for a folder
containing both `.obsidian/` and `raw/` → `~/.config/second-brain/config.json` → ask. State
the resolved path before writing.

## Step 2 — Determine target tags
- Tags named in the request → use those.
- None given → use `generated_tags` from the state file (refresh what already exists).
- No state and none given → ask the user which tags to build. Never build a page per tag
  automatically.

## Step 3 — Load state
Read `<vault>/wiki/.second-brain-index.json` (create `wiki/` if missing; start empty if there
is no state). Schema and page layout are in the reference file; the state holds
`generated_tags`, `last_run`, and a `notes` summary-cache keyed by vault-relative path with a
content `hash` and cached `summary_md`.

## Step 4 — Find the notes that need summarizing
- List every `raw/**/*.md` (skip `attachments/`). Parse each note's front matter `tags` and
  `date`, and take the first `# ` heading as the title.
- Keep notes whose tags intersect the target tags ("relevant notes").
- Hash each relevant note (`shasum -a 256 <file>`). A note is **stale** if it's absent from
  the cache or its hash changed. Non-stale notes reuse their cached `summary_md`.
- **Rebuild mode:** if the request asks to re-index / rebuild from scratch ("re-index
  everything", "rebuild the wiki from scratch", "full reindex"), treat **all** relevant notes
  as stale — ignore the cache and regenerate every summary in the current format. On a full
  rebuild with no tags named, target every tag in `generated_tags`.

## Step 5 — Summarize the stale notes
Read each stale note and write a **compressed, scannable summary** per the quality bar in the
reference: mostly tight prose (1–3 short paragraphs). **Bold sparingly** — at most ~4 bold
phrases in the whole summary, each a short meaningful phrase of up to ~5 words, never scattered
single words. Use bullets only for a genuine short list. Include the single most important table
(copied) or one embedded image (`![[file.png]]`) if clearly central — otherwise neither. Don't
repeat the title or backlink. Update that note's `hash`, `date`, `title`, `tags`, and
`summary_md` in the cache.

## Step 6 — Render each target tag page
For each target tag, collect relevant notes carrying it, sort **newest date first**, and write
`<vault>/wiki/<tag>.md` exactly as in the reference: front matter (`area`, `last_update`,
`note_count`, `tags: [wiki]`), an `# <tag> — wiki` title, then one block per note —
`## Title`, a line with the readable date (`May 17, 2026`) + tag chips + backlink
`[[<note-basename>|open full note]]`, then the cached `summary_md`, `---` between blocks.

## Step 7 — Save state and report
Set `generated_tags` = union(existing, target tags) and `last_run` = now; write the state
file. Report each page written, its note count, and how many notes were newly summarized vs.
reused from cache. Do not commit or modify anything outside `wiki/`.
