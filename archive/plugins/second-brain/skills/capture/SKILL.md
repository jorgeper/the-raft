---
name: capture
description: >-
  Create a new note in the user's Obsidian vault raw/ capture folder. Use when they say
  things like "create a note about X", "capture this", "save this link/video/article",
  "add this to my brain", or paste a URL, YouTube link, image path, document, or text to
  save. Handles vault detection, slug and path, front matter (with a tldr), summary, and
  image attachments. Append-only — never edits existing notes, manual/, or ai/.
---

# Second Brain — capture a raw note

Create **exactly one** new note in the vault's `raw/` folder. Decide the mode from the input:

- **Blank** — only a topic/phrase is given → front matter + `# Title` + empty body.
- **Hydrated** — a source is given (URL, YouTube link, webpage, local image/doc path, or
  pasted text) → fetch/analyze it, summarize, and preserve the original.

Hard rules: never edit or delete an existing note; never write into `manual/` or `ai/`;
`raw/` is append-only.

The canonical format (front matter + body templates + examples) lives in
`${CLAUDE_PLUGIN_ROOT}/reference/raw-note-format.md` — read it if you need the exact
templates. The essentials are inlined below.

## Step 1 — Resolve the vault (first match wins)

1. A path or a vault named in the request → use it.
2. Walk up from the current working directory for a folder that contains **both**
   `.obsidian/` and `raw/`. That folder is the vault.
3. `~/.config/second-brain/config.json` → read `.vault_path`.
4. Still unknown → ask the user for the vault path. Then offer to remember it: write
   `{"vault_path": "<path>"}` to `~/.config/second-brain/config.json` (create the dir).

State the resolved vault path to the user before the first write of the session.

## Step 2 — Date, slug, path

- Date = today (`YYYY-MM-DD`) unless the user specifies one.
- Slug = lowercase, hyphen-separated, derived from the title/topic; keep it short (drop
  filler words).
- Path = `<vault>/raw/<YYYY-MM>/<YYYY-MM-DD>-<slug>.md`.
- If that file exists, append `-2`, `-3`, … Create `raw/<YYYY-MM>/` (and `attachments/` when
  needed) if missing.

## Step 3 — Front matter (lean + tldr)

```yaml
---
date: <YYYY-MM-DD>
source: <youtube|article|url|image|text|note>
url: <link>                # include for link sources; omit otherwise
tldr: <one–two sentences>  # hydrated notes only; omit for blank
tags: [<2–6 short tags>]
status: <to-watch|to-read|to-buy|reference|done|captured>
kind: <video|article|product|image|idea|note>
---
```

## Step 4 — Body

- **Blank:** just `# <Title>` and an empty body.
- **Hydrated:** `# <Title>`, a one-line meta line (author/channel · duration/site · date as
  known), then `## Summary` (a short paragraph — longer than the tldr), and `## Key points`
  only when the source has clear structure.
- **Image:** copy the source image into `raw/<YYYY-MM>/attachments/<YYYY-MM-DD>-<slug>.<ext>`,
  embed with `![[<file>]]`, set `image_path:` in front matter, and write `## AI Description`
  from what you see.
- **Pasted text:** keep it verbatim in a `> [!quote] Original` callout, then `## Summary`.

## Step 5 — Hydration (best effort)

- Links / YouTube / webpages: fetch with the available web tool. Pull title, author or
  channel, site, date, and enough content to write the `tldr` and `## Summary`. If the fetch
  is thin (e.g. a YouTube page with no transcript), summarize what you can and **always** keep
  the URL in `url:`. Do not fabricate details you didn't retrieve.
- Images/docs: read the file directly.

## Step 6 — Finish

Report the created file path and the `tldr`. Do not commit, move, or modify anything else.
