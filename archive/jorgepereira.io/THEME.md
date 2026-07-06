# THEME.md — the jorgepereira.io look & feel

The default visual theme for every app under `jorgepereira.io`. It's a claude.ai-inspired design:
warm off-whites, near-black ink, one terracotta accent, hairline borders, dense-but-airy small
type, serif reserved for headings and big numbers. Extracted from
`financial-dashboard.html` (the financial command center), which is the visual reference.

**Rule for new apps:** copy the token block below into the app's `client/src/theme.css` and style
every component with `var(--…)` only — no hardcoded colors, fonts, radii, or shadows outside that
file. (Buckos predates this doc and has its own cream/terracotta theme; new apps use this one.)

## Design principles

1. **Warm, not white.** The page is `#faf9f5` off-white; cards are pure white on top of it.
   Elevation is expressed by stepping through surfaces (`--surface` → `--surface2` → `--surface3`),
   not by heavy shadows.
2. **Ink, not black.** Text is warm near-black `#1a1915` with two deliberate softer steps
   (`--ink2` for secondary, `--muted` for labels/hints). Three text colors, used consistently.
3. **One accent.** Terracotta `#d97757` marks interactivity and emphasis (toggles on, selection
   tint, callout borders); `--accent-deep` for links. Everything else stays neutral.
4. **Hairline everything.** Borders are `rgba(26,25,21,.09)`; card shadow is nearly invisible
   (`0 1px 2px rgba(26,25,21,.03)`). Depth comes from surface steps and hairlines.
5. **Small type, generous hierarchy.** Base is 13.5px/1.45. Hierarchy comes from weight, case,
   letter-spacing and the serif — not from big font sizes.
6. **Serif = importance.** `--font-serif` (Anthropic Serif) appears only in page titles, section
   headings, and hero numbers. Everything functional is the sans (Anthropic Sans).
7. **Numbers are data.** Always `font-variant-numeric: tabular-nums`, right-aligned in tables;
   big standout numbers get the serif with slightly negative letter-spacing.

## The tokens (copy into `client/src/theme.css`)

```css
:root {
  /* surfaces — warm off-whites, elevation by stepping */
  --page: #faf9f5;        /* app background */
  --surface: #ffffff;     /* cards */
  --surface2: #f4f2ec;    /* hover states, inputs, chips */
  --surface3: #ece9e2;    /* pressed states, pills, secondary buttons */

  /* text — three steps of warm ink */
  --ink: #1a1915;         /* primary text, big numbers */
  --ink2: #52514e;        /* secondary text, card headings, body prose */
  --muted: #87867f;       /* labels, hints, footers */

  /* lines */
  --border: rgba(26,25,21,.09);  /* card + control hairlines */
  --grid: #e8e6df;               /* table row lines, chart gridlines */
  --baseline: #d5d3ca;           /* separators, chart axis baselines */

  /* accent — terracotta, used sparingly */
  --accent: #d97757;        /* toggles on, callout borders, selection */
  --accent-deep: #a54a2a;   /* links */
  --accent-tint: #f7e8e0;   /* selected-row / active-chip background */

  /* tinted fills */
  --note-bg: #f2ede4;                                      /* callout background */
  --hero-grad: linear-gradient(135deg, #f5eee3, #faf3ea);  /* hero panels */
  --good-bg: #e9f4e9; --warn-bg: #f8efdd; --crit-bg: #fbeaea;  /* status pill fills */

  /* semantic */
  --good: #0ca30c; --warn: #b97e0a; --crit: #d03b3b;

  /* categorical chart palette (dataviz light, validated) */
  --s1: #2a78d6; --s2: #1baf7a; --s3: #eda100; --s4: #008300;
  --s5: #4a3aa7; --s6: #e34948; --s7: #e87ba4; --s8: #eb6834;
  --gray: #a3a199;   /* "other" / de-emphasized series */

  /* type — Anthropic Sans / Anthropic Serif first, graceful fallbacks after */
  --font-sans: "Anthropic Sans", "Styrene A", "Avenir Next", Avenir, -apple-system, "Segoe UI", system-ui, sans-serif;
  --font-serif: "Anthropic Serif", "Tiempos Headline", ui-serif, Georgia, "Times New Roman", serif;

  /* shape + depth */
  --r-ctl: 7px;      /* inputs, small buttons */
  --r-chip: 18px;    /* chips (pill-shaped) */
  --r-card: 12px;    /* cards */
  --r-panel: 14px;   /* modals, hero panels */
  --shadow-card: 0 1px 2px rgba(26,25,21,.03);
  --shadow-modal: 0 24px 60px rgba(26,25,21,.25);
  --backdrop: rgba(26,25,21,.35);
}

* { box-sizing: border-box; margin: 0; padding: 0 }
body {
  background: var(--page);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.45;
}
a { color: var(--accent-deep) }
```

Notes:
- **Fonts:** the theme explicitly targets **Anthropic Sans** and **Anthropic Serif** — every app
  uses these two families via `--font-sans` / `--font-serif`. They (and Styrene/Tiempos) are
  commercial fonts, so they render when available (installed locally or self-hosted `@font-face`
  files the app ships); otherwise the stacks degrade gracefully (Avenir/system-ui and Georgia
  look right). Never substitute a different webfont — ship the stacks as-is.
- **Light theme only** for now — that's the look. If an app ever needs dark mode, add a
  `:root[data-theme='dark']` token block; components don't change (that's the point of tokens).

## Type scale

| Role | Font | Size | Weight | Extras |
|---|---|---|---|---|
| Page title (header h1) | serif | 17px | 600 | letter-spacing −0.2px |
| Section heading (h2) | serif | 15px | 650 | 7px accent dot before it |
| Hero statement | serif | 30px | 650 | letter-spacing −0.5px |
| Hero/header number | serif | 17px | 650 | letter-spacing −0.3px, tabular-nums |
| KPI value | sans | 20px | 650 | letter-spacing −0.3px, tabular-nums |
| KPI label / table header | sans | 10.5px | 500 | uppercase, letter-spacing .05em, `--muted` |
| Card heading (h3) | sans | 12.5px | 600 | `--ink2`, inline `--muted` 11px hint after |
| Body / prose | sans | 12.8px | 400 | `--ink2`, `<b>` pops in `--ink` |
| Table cells | sans | 12.2px | 400 | numbers right-aligned tabular-nums |
| Controls (nav, chips, inputs) | sans | 12–13px | 400–550 | |
| Hints, sublabels, footers | sans | 10.5–11.5px | 400 | `--muted` |
| Tags | sans | 9.5px | 400 | bordered, `--muted` |

## Component recipes

**Card** — the universal container:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  padding: 13px 15px;
  box-shadow: var(--shadow-card);
}
.card h3 { font-size: 12.5px; font-weight: 600; color: var(--ink2); margin-bottom: 10px; }
```

**Sticky header** — translucent page color with blur, hairline bottom:

```css
header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(250,249,245,.94);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
```

**Nav pills** — ghost buttons; the active one inverts to ink:

```css
nav button { background: none; border: none; color: var(--ink2); font-size: 13px;
  font-weight: 550; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
nav button:hover { background: var(--surface2) }
nav button.active { background: var(--ink); color: var(--page) }
```

**KPI tile** — label / value / delta inside a card:

```css
.k { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em }
.v { font-size: 20px; font-weight: 650; margin-top: 3px; letter-spacing: -.3px }
.d { font-size: 11.5px; color: var(--muted); margin-top: 2px }
```

**Callout / note** — tinted panel with a 3px accent left border:

```css
.note { background: var(--note-bg); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: 10px;
  padding: 9px 13px; font-size: 12px; color: var(--ink2); }
```

Warning/critical variants: keep the card, switch the left border (and heading color) to
`var(--warn)` / `var(--crit)`.

**Chips** (filters, removable slices) — pill-shaped, accent-tinted when on:

```css
.chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--r-chip); padding: 4px 11px;
  font-size: 12px; color: var(--ink2); cursor: pointer; user-select: none; }
.chip.on { background: var(--accent-tint); border-color: var(--accent); color: var(--ink) }
```

**Tables** — muted uppercase sticky headers, hairline rows, hover highlight:

```css
table { width: 100%; border-collapse: collapse; font-size: 12.2px }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid) }
th { color: var(--muted); font-weight: 500; font-size: 10.5px; text-transform: uppercase;
  letter-spacing: .04em; position: sticky; top: 0; background: var(--surface); z-index: 1 }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums }
tr:last-child td { border-bottom: none }
tbody tr:hover { background: var(--surface2) }
.tscroll { max-height: 420px; overflow: auto; border: 1px solid var(--grid); border-radius: 9px }
```

**Status pills** — tinted background + semantic text color:

```css
.pill { display: inline-block; font-size: 10px; padding: 1px 7px; border-radius: 11px;
  background: var(--surface3); color: var(--ink2); white-space: nowrap }
/* variants: background: var(--good-bg); color: var(--good)  (same for warn/crit) */
```

**Toggle switch** — small, accent when on:

```css
.tog .sl { width: 28px; height: 16px; border-radius: 9px; background: var(--surface3);
  position: relative; transition: .15s }
.tog .sl:after { content: ""; position: absolute; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); top: 2px; left: 2px; transition: .15s }
.tog input:checked + .sl { background: var(--accent) }
.tog input:checked + .sl:after { left: 14px }
```

**Section heading** — serif with a small accent dot:

```css
h2.sech { font-family: var(--font-serif); font-size: 15px; font-weight: 650;
  margin: 22px 0 10px; display: flex; align-items: center; gap: 8px }
h2.sech .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent) }
```

**Hero panel** — warm gradient for the one big statement per page:

```css
.hero { background: var(--hero-grad); border: 1px solid var(--border);
  border-radius: var(--r-panel); padding: 20px 22px }
.hero .big { font-family: var(--font-serif); font-size: 30px; font-weight: 650;
  letter-spacing: -.5px }
.hero .card { background: rgba(255,255,255,.65) }   /* nested cards go translucent */
```

**Modal / dialog** — page-colored, big radius, the one place a real shadow appears:

```css
dialog { border: 1px solid var(--border); border-radius: var(--r-panel);
  background: var(--page); color: var(--ink); box-shadow: var(--shadow-modal) }
dialog::backdrop { background: var(--backdrop) }
```

## Layout & interaction rules

- **Grid gap 12px**; KPI rows are `repeat(4, 1fr)` collapsing to 2 columns under 900px;
  two-column content is `1.15fr 1fr` collapsing to one column under ~980px.
- **Content column:** `max-width: 1220px; margin: 0 auto; padding: 0 22px`.
- **Hover = one surface step up** (`--surface2` on rows, buttons, bars); **selected = accent
  tint** (`--accent-tint`). Never change layout on hover.
- **Transitions:** `.15s` on small controls; none on layout.
- **Radii:** controls 7–8px · chips 18px · cards 12px · modals/hero 14px.
- **Forms:** inputs sit on `--surface2` with hairline borders, radius `--r-ctl`, `font: inherit`.

## Charts

- Series colors come from `--s1`…`--s8` in order; use `--gray` for "other"/de-emphasized series
  and `--good`/`--warn`/`--crit` only for semantic meaning.
- Gridlines `--grid`, axis baselines `--baseline`, tick labels `--muted` at 10.5–11px.
- No chart borders, no heavy legends — prefer labeled HTML bar rows (label · track · tabular
  value) for rankings; keep canvases inside a `.chartbox` with a fixed height (280–320px).
