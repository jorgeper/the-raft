# Second Brain

A small plugin for managing an [Obsidian](https://obsidian.md) vault's `raw/` capture folder.
Two skills:

- **capture** — creates a **blank** note from a topic ("create a note about X"), or
  **hydrates** a note from a source you give it (URL, YouTube link, webpage, image, doc, or
  pasted text) by summarizing it, writing a `tldr`, and preserving the original. It writes to
  `raw/<YYYY-MM>/<YYYY-MM-DD>-<slug>.md` and, after writing, shows the tags it used and offers
  to adjust them (you can also pass tags explicitly: `tag: llm` / `tags: llm, data`).
- **wiki** — generates a browsable per-area digest: one page per chosen tag at
  `wiki/<tag>.md`, stacking compressed summaries (with the key table/image) of every raw note
  carrying that tag, newest first, each with a backlink to the original. Incremental — it only
  re-summarizes new or changed notes, tracked in a state file in the vault.

Everything is **append-only / additive**: it never edits existing raw notes and never touches
your `manual/` or `ai/` folders. `wiki` writes only under `wiki/`.

It installs in **two** tools — pick the one you use. The instructions are independent; you
don't need to read both.

---

## Install for Claude Code

The `plugins/` directory in this repo is a Claude Code marketplace named `sandbox-plugins`.

```bash
# 1. Register the local marketplace (point at the plugins/ directory)
claude plugin marketplace add ~/src/sandbox/plugins

# 2. Install the plugin
claude plugin install second-brain@sandbox-plugins

# 3. Verify
claude plugin marketplace list
```

Then, in any Claude Code session, just ask naturally — the skills load by description:

```
# capture
create a note about the espresso puck-collapse thing
capture this: https://www.youtube.com/watch?v=…   tag: coffee
save this image ~/Downloads/diagram.png as a note

# wiki
update the wiki for coffee, ai, workflow
update the wiki                       # refreshes every tag it already tracks (incremental)
rebuild the wiki from scratch         # re-index everything, ignoring the cache
re-index everything for coffee, ai    # full rebuild of just those tags
```

To update after you change the plugin files: `claude plugin marketplace update sandbox-plugins`.

---

## Install for GitHub Copilot CLI

Copilot CLI doesn't support custom slash commands yet, so this ships as **custom agents** —
one for capture, one for the wiki. Install by copying (or symlinking) both agent files into
your user agents directory:

```bash
# Copy both agents into your personal Copilot agents directory
mkdir -p ~/.copilot/agents
cp ~/src/sandbox/plugins/second-brain/agents/*.agent.md ~/.copilot/agents/

# (Optional) symlink instead, so they update when you pull this repo:
# ln -sf ~/src/sandbox/plugins/second-brain/agents/second-brain.agent.md      ~/.copilot/agents/
# ln -sf ~/src/sandbox/plugins/second-brain/agents/second-brain-wiki.agent.md ~/.copilot/agents/
```

Then use them from the Copilot CLI:

```bash
# Interactive: pick an agent
copilot
# …then run: /agent   and choose "Second Brain" (capture) or "Second Brain Wiki"

# Or invoke directly:
copilot --agent second-brain      -p "capture this: https://www.youtube.com/watch?v=…  tag: coffee"
copilot --agent second-brain-wiki -p "update the wiki for coffee, ai, workflow"
```

To verify, run `/agent` in an interactive session and confirm **Second Brain** and **Second
Brain Wiki** appear.

---

## Where does it write? (vault resolution)

The skill figures out which vault to use, in this order (first match wins):

1. A vault path/name you mention in the request.
2. **Auto-detect** — it walks up from your current directory for a folder containing both
   `.obsidian/` and `raw/`. So if you run the tool inside your vault, there's nothing to
   configure.
3. A saved path in `~/.config/second-brain/config.json` (`{ "vault_path": "..." }`).
4. If none of the above, it asks you once and offers to save your answer to that config file.

To change it later: run inside a different vault (auto-detect wins), say "set my second brain
vault to `<path>`", or edit/delete `~/.config/second-brain/config.json`.

---

## What it writes

Front matter (canonical format — full spec in [`reference/raw-note-format.md`](reference/raw-note-format.md)):

```yaml
---
date: 2026-07-04
source: youtube            # youtube | article | url | image | text | note
url: https://youtu.be/…    # link sources only
tldr: One–two sentence summary   # hydrated notes only
tags: [ai, workflow]
status: to-watch           # to-watch | to-read | to-buy | reference | done | captured
kind: video                # video | article | product | image | idea | note
---
```

Body: an `# H1` title, a one-line source/meta line, a `## Summary`, and (when the source has
structure) `## Key points`. Images are copied into `raw/<YYYY-MM>/attachments/` and embedded
with an `## AI Description`; pasted text is preserved in a `> [!quote] Original` callout.

## What it does NOT do

- Doesn't touch `manual/` or `ai/`.
- Doesn't edit, move, reorganize, or delete existing notes.
- Doesn't commit anything to git — that's up to you.

## Layout

```
second-brain/
├── README.md                          # this file
├── DESIGN.md                          # design spec
├── .claude-plugin/plugin.json         # Claude Code plugin manifest
├── skills/
│   ├── capture/SKILL.md               # Claude skill: capture a raw note
│   └── wiki/SKILL.md                  # Claude skill: build/update the area wiki
├── agents/
│   ├── second-brain.agent.md          # Copilot agent: capture
│   └── second-brain-wiki.agent.md     # Copilot agent: wiki
└── reference/
    ├── raw-note-format.md             # canonical raw-note format
    └── wiki-page-format.md            # canonical wiki-page + state format
```
(The Claude Code marketplace manifest is one level up, at `plugins/.claude-plugin/marketplace.json`.)
