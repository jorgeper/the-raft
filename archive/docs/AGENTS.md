# AGENTS.md — `docs/` (jorgeper.github.io)

Instructions for any AI agent (Claude, GitHub Copilot, Cursor, …) that adds or edits pages in this folder.

This folder is published as a GitHub Pages site at **https://jorgeper.github.io/sandbox/**
(source: `main` → `/docs`, served as plain static files — no Jekyll build).

## Adding a new page

1. Create `docs/<slug>.html`. It is served at `https://jorgeper.github.io/sandbox/<slug>.html`.
2. Link the shared stylesheet in `<head>` so every page shares one look:
   ```html
   <link rel="stylesheet" href="assets/theme.css">
   ```
   Use **relative** paths (`assets/theme.css`), not absolute (`/assets/...`) — the site lives under the `/sandbox/` sub-path, so absolute paths break.
3. Add a card linking the new page to `index.html`, inside `<ul class="pages">`.

## Theme

All shared styling lives in `assets/theme.css`. Don't hard-code colours or fonts into a page — use the CSS variables it defines:

- Paper background `--bg` `#FAF9F5`, cards `--bg-card`, terracotta accent `--accent` `#C6613F`.
- Serif for display type (`--serif`), system sans for body (`--sans`), mono for code (`--mono`).
- Ready-made helpers: `.wrap` (centered column), `.eyebrow`, `.muted`, callouts `.note` / `.warn` / `.win`, and the `.pages` link list used on the index.

If a page needs bespoke components (diagrams, a sidebar, etc.), add a page-scoped `<style>` block in that file — but keep its colours and fonts referencing the theme variables above.

## Reference

`the-agentic-loop.html` is the fully-featured example of the house style. It predates `theme.css` and carries its own inline copy of the palette; **new pages should link the shared stylesheet instead** of copying that inline block.
