# Second Brain — Design Spec

**Date:** 2026-07-04
**Status:** Draft for review

## Goal

A plugin called **Second Brain** that helps manage an Obsidian vault's `raw/` capture
folder. It is installable in **both** the GitHub Copilot CLI and Claude Code. It exposes
**one adaptive skill** ("capture") that creates new notes in `raw/` — either a blank note
from a topic, or a note hydrated from a source (link, YouTube, webpage, image, doc, or
pasted text).

Non-goals: it does **not** manage the `manual/` or `ai/` folders, and it never edits or
deletes existing notes. `raw/` is treated as append-only.

## Vault conventions (learned from the personal `brain` vault, read-only)

- Notes live at `raw/YYYY-MM/YYYY-MM-DD-<slug>.md`.
- Images live at `raw/YYYY-MM/attachments/`, embedded with `![[file.png]]` and recorded
  in front matter via `image_path:`.
- Body pattern: `# Title`, a one-line source/meta line, a summary section, then key points.
  Images add an `## AI Description`; pasted text/reminders use a `> [!quote]` callout.
- Front matter had drifted into two formats (a minimal one and a richer one). This spec
  defines a single canonical format going forward. Existing notes are left untouched.

## Canonical front matter (lean + tldr)

```yaml
---
date: 2026-07-04           # capture date (matches the filename date)
source: youtube            # youtube | article | url | image | text | note
url: https://youtu.be/…    # present when there is a link source; omitted otherwise
tldr: One–two sentence summary   # hydrated notes only; omitted for blank notes
tags: [ai, workflow]
status: to-watch           # to-watch | to-read | to-buy | reference | done | captured
kind: video                # video | article | product | image | idea | note
---
```

## Body layout

**Blank note (topic only):**
```
# <Title derived from topic>

<empty body>
```

**Hydrated note (from a source):**
```
# <Title>

<one-line source/meta: author · duration/site · date, as available>

## Summary
<extended summary — a short paragraph, longer than the tldr>

## Key points        (optional, when the source has clear structure)
- …
```

- **Image source:** embed `![[YYYY-MM-DD-<slug>.<ext>]]` under the title, then
  `## AI Description` with a vision-generated description. The image file is copied into
  `raw/YYYY-MM/attachments/` and recorded in `image_path:`.
- **Pasted text source:** keep the original verbatim in a `> [!quote] Original` callout,
  then the summary.

## The one adaptive skill: "capture"

**Input:** a topic phrase, and/or a source (URL, YouTube link, local file/image path, or
pasted text).

**Branch:**
- No source → **blank note** (front matter + title + empty body).
- Source present → **hydrated note** (fetch/analyze, write `tldr` in front matter,
  `## Summary` in body, preserve the original source).

**Vault resolution (run at the start, first match wins):**
1. Explicit in the request (a path, or a named vault) → use it.
2. Auto-detect: walk up from the current working directory for a folder containing both
   `.obsidian/` and `raw/`.
3. Saved config: `~/.config/second-brain/config.json` → `{ "vault_path": "..." }`.
4. None found → ask the user once, then offer to save the answer to the config file.

**Path & slug rules:**
- Date defaults to today (override if the user specifies).
- Slug = lowercase, hyphenated, derived from the title/topic; de-duplicated with a numeric
  suffix if the target file already exists.
- Create `raw/YYYY-MM/` (and `attachments/`) if missing.

**Hydration sourcing:** best-effort via the host tool's built-in fetch/read capability
(`WebFetch`/`Read` in Claude Code; the Copilot CLI's fetch/read). For YouTube/webpages it
pulls what is publicly available (title, channel/site, description, article text). It does
not assume a transcript source, but always preserves the link. *(Open question below.)*

**Guardrails:** append-only in `raw/`; never touch `manual/` or `ai/`; never edit or delete
existing notes; confirm the resolved vault path before the first write in a session.

## Packaging (dual tool support)

```
sandbox/plugins/                          # Claude Code marketplace root
├── .claude-plugin/
│   └── marketplace.json                  # lists second-brain (enables `plugin install`)
└── second-brain/                         # the plugin
    ├── README.md                         # separate install sections: Claude Code, Copilot CLI
    ├── DESIGN.md                         # this spec
    ├── .claude-plugin/
    │   └── plugin.json                   # Claude Code plugin manifest
    ├── skills/
    │   └── capture/
    │       └── SKILL.md                  # Claude Code skill
    ├── agents/
    │   └── second-brain.agent.md         # Copilot CLI custom agent (name + description + body)
    └── reference/
        └── raw-note-format.md            # canonical front matter + body spec (single source of truth)
```

- **Claude Code:** a standard plugin. `skills/capture/SKILL.md` auto-loads by description
  ("create/capture a note in the Obsidian raw folder"). Installed via a local marketplace
  entry (`.claude-plugin/marketplace.json`).
- **Copilot CLI:** a custom agent. `second-brain.agent.md` uses the `*.agent.md` format;
  installed by copying/symlinking it to `~/.copilot/agents/` (user-level). Invoked with
  `/agent` or `copilot --agent second-brain -p "…"`.
- Both wrappers delegate the actual note format to `reference/raw-note-format.md`, so the
  behavior is defined once and stays in sync.

## Config file

`~/.config/second-brain/config.json`:
```json
{ "vault_path": "/Users/jorgeper/src/brain" }
```
Written on first-run only when auto-detect fails. Editable/removable by hand. Read by both
tools (same user, same file). To change the vault: run inside a different vault (auto-detect
wins), say "set my second brain vault to `<path>`", or edit this file.

## README structure

Two independent, self-contained sections so the reader never cross-references:
1. **Install for Claude Code** — add local marketplace, `plugin install`, verify.
2. **Install for GitHub Copilot CLI** — copy the agent file to `~/.copilot/agents/`, verify
   with `/agent`.
Plus a short "Usage" section with example prompts for both tools, and a "What it does /
does not touch" note.

## Out of scope (YAGNI)

- No skills for `manual/` or `ai/`.
- No editing/reorganizing/back-filling existing notes.
- No multi-vault alias registry (auto-detect + single saved path covers it).
- No dedicated "config" skill (folded into the one capture skill).

## Open questions for review

1. **YouTube hydration:** default is best-effort via the host's web fetch (title, channel,
   description) — no transcript tool assumed. If you have an MCP/tool that pulls transcripts,
   name it and the skill will prefer it.
2. Anything about the canonical front matter or body layout you'd tweak before build.

---

# Addendum (v0.2.0): explicit tagging + the wiki skill

Added 2026-07-04. Confirmed decisions: state in the vault, notes newest-first, capture reports
tags and offers to adjust (non-blocking), wiki ships for both Claude Code and Copilot CLI.

## capture — explicit tagging

- Accept inline tags in the request: `tag: llm` or `tags: llm, data` → always included; infer
  extras only when none are given.
- After writing the note, report the tags used and **offer** to change/add them (not a hard
  stop). On a change request, update only the `tags:` field.

## wiki — one browsable page per area

- Output: `<vault>/wiki/<tag>.md` (filename is just the tag). Reads `raw/`, writes only under
  `wiki/`. Never touches `manual/`, `ai/`, or existing raw notes.
- **Tag selection:** tags named in the request, else the `generated_tags` in state (refresh
  what exists), else ask. Never auto-generates a page per tag.
- **Page layout:** front matter (`area`, `last_update`, `note_count`, `tags: [wiki]`); then,
  per note (newest date first): `## Title`, a line with the human date (`May 17, 2026`) + tag
  chips + a top backlink `[[<basename>|open full note]]`, then a compressed summary that pulls
  in the single most important table/image.
- **Incremental:** a vault-local state file `<vault>/wiki/.second-brain-index.json` caches each
  note's `summary_md` keyed by content hash, plus `generated_tags` and `last_run`. Only stale
  (new/changed-hash) notes are re-summarized; pages are rebuilt from cache in date order so
  ordering stays correct when back-dated notes arrive. Canonical schema + page format:
  `reference/wiki-page-format.md`.
- **Packaging:** Claude skill `skills/wiki/SKILL.md` + Copilot agent
  `agents/second-brain-wiki.agent.md`, both delegating format to the reference file.

## Deliberately deferred

- **Nightly automation:** run explicitly for now. When automating (cron) or once the vault
  grows large, replace the model-maintained state/render with a deterministic helper script
  (model keeps doing only the summarization). Flagged as the natural next step.
