---
name: Second Brain Wiki
description: >-
  Generate or update the browsable "wiki" for an Obsidian vault — one markdown page per chosen
  tag/area under wiki/, each stacking compressed summaries of every raw note with that tag,
  newest first, with backlinks to the originals. Use for "update the wiki", "build the wiki
  for llm, data", etc. Incremental: only re-summarizes new or changed notes. Writes only under
  wiki/ — never edits raw/, manual/, or ai/.
---

# Second Brain — build/update the area wiki

You produce one page per selected tag at `<vault>/wiki/<tag>.md`, each stacking compressed
summaries of the raw notes carrying that tag, **newest date first**, with a backlink to each
original. This agent file is self-contained.

Write **only** under `<vault>/wiki/` — the tag pages and the state file. Read `raw/` but never
modify it. Never touch `manual/` or `ai/`.

## Step 1 — Resolve the vault
A path/name in the request → walk up from the current directory for a folder containing both
`.obsidian/` and `raw/` → `~/.config/second-brain/config.json` → ask. State the resolved path.

## Step 2 — Determine target tags
- Tags named in the request → use those.
- None given → use `generated_tags` from the state file (refresh what already exists).
- No state and none given → ask which tags to build. Never build a page per tag automatically.

## Step 3 — Load state
Read `<vault>/wiki/.second-brain-index.json` (create `wiki/` if missing; empty if no state):
```json
{
  "version": 1,
  "generated_tags": ["llm", "data"],
  "last_run": "<ISO>",
  "notes": {
    "raw/2026-05/2026-05-17-coffee-physics-physicsworld.md": {
      "hash": "<sha256>", "date": "2026-05-17",
      "title": "Coffee with a Splash of Physics",
      "tags": ["coffee","physics","espresso","article"],
      "summary_md": "<cached compressed summary>"
    }
  }
}
```

## Step 4 — Find notes needing summaries
List every `raw/**/*.md` (skip `attachments/`); parse front matter `tags`/`date` and the first
`# ` heading as the title. Keep notes whose tags intersect the target tags. Hash each
(`shasum -a 256 <file>`); a note is **stale** if absent from the cache or its hash changed.
Non-stale notes reuse cached `summary_md`.

**Rebuild mode:** if the request asks to re-index / rebuild from scratch ("re-index
everything", "rebuild the wiki from scratch", "full reindex"), treat **all** relevant notes as
stale — ignore the cache and regenerate every summary in the current format. On a full rebuild
with no tags named, target every tag in `generated_tags`.

## Step 5 — Summarize stale notes
Read each stale note and write a **compressed, scannable summary**: an optional one-line
framing sentence, then **3–6 bullet points** each starting with a **bold lead-in**, and the
highest-signal terms/names/numbers **bolded** inline. Include the single most important table
(copied) or one embedded image (`![[file.png]]`) if clearly central — otherwise neither. No
wall of text; never invent content; don't repeat the title or backlink. Update the note's
`hash`, `date`, `title`, `tags`, `summary_md` in the cache.

## Step 6 — Render each target tag page
For each target tag, collect relevant notes carrying it, sort **newest date first**, write
`<vault>/wiki/<tag>.md`:
```markdown
---
area: <tag>
last_update: <ISO>
note_count: <N>
tags: [wiki]
---

# <tag> — wiki

## <Title>
May 17, 2026 · #tag1 #tag2 · [[<note-basename>|open full note]]

<summary_md>

---
```

## Step 7 — Save state and report
Set `generated_tags` = union(existing, target tags), `last_run` = now; write the state file.
Report each page written, its note count, and newly-summarized vs. reused counts. Do not
commit or modify anything outside `wiki/`.
