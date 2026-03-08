# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

This is a vanilla JS single-page app with no build step. Serve it locally:

```bash
python -m http.server 8000
# or
npx http-server
```

Then open `http://localhost:8000` in a browser.

## Architecture

Three files — no frameworks, no dependencies:

- `index.html` — All screen and modal HTML markup
- `app.js` — Entire application logic (~1,641 lines, wrapped in a single IIFE)
- `styles.css` — All styles with CSS custom properties for theming

### State

A single mutable `state` object holds everything (days, savedWorkouts, settings, timer, editing context). Changes follow the pattern: mutate state → call `save()` → call the relevant render function.

### Persistence

localStorage only, using keys `wb_days`, `wb_saved_workouts`, `wb_settings`. Old keys (`wb_workouts`, `wb_templates`) are auto-migrated on load.

### Navigation

`showScreen(name)` and `showModal(id)` toggle visibility via CSS classes. No routing library. Screen names: `day`, `workouts`, `analytics`, `settings`.

### Rendering

Screens are re-rendered by replacing `innerHTML` with HTML strings built from state. Event delegation is used on container elements — handlers use `event.target.closest()` to identify the action.

### app.js Section Map

| Section | Approx. Lines |
|---------|--------------|
| Storage keys & state | 8–35 |
| Helpers (date, formatting) | 40–117 |
| Theme & persistence | 121–192 |
| Data queries (history, PRs, stats) | 197–343 |
| Timer logic | 347–404 |
| DOM helpers & screen switching | 408–430 |
| Day screen rendering | 434–619 |
| Add-exercise & load/save modals | 624–805 |
| Workouts screen & edit flow | 807–913 |
| Settings & analytics (incl. SVG charts) | 915–1250 |
| Event binding (`bindEvents`) | 1260–1623 |
| Init | 1626–1641 |

### Theme System

Two themes toggled via `data-theme` on `<html>`: `dark` (Midnight Forge) and `light` (Warm Linen). All colors are CSS custom properties.

### Developer Mode

Enabled in Settings. Adds a button to generate realistic test data (workout days + saved workouts) and a reset button to wipe all data.

### Analytics Charts

SVG charts are built inline (no charting library). `getExerciseHistory(name)` drives weight and volume progression charts; `getPersonalRecords()` and `getWorkoutStats()` power the summary section.
