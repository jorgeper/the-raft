# Rippy Rippy — SPEC

A multi-user workout tracking app at **rippy-rippy.jorgepereira.io**. It is the rebrand and
server-backed rewrite of the existing `sandbox/workout-app` ("Workout Book", vanilla JS +
localStorage), rebuilt on the jorgepereira.io app pattern so I can share it with friends: Google
sign-in, per-user private data on the server, the shared jorgepereira.io theme, and the standard
VPS deployment.

**Read these first — they are binding:**
- [`../ADDING-AN-APP.md`](../ADDING-AN-APP.md) — architecture, env conventions, wiring, deployment
- [`../THEME.md`](../THEME.md) — the look & feel; copy its token block into `client/src/theme.css`
- [`../buckos/`](../buckos) — reference implementation for stack, auth, avatar/settings UX, tests
- `sandbox/workout-app/` (repo root) — the source app whose functionality is being ported
  (`app.js`, `index.html`, `styles.css`, `default-library.json`)

## 1. Product summary

Rippy Rippy is a phone-first workout log. Each day is a page in your training book: you add
exercises (from a rich built-in library or free-typed), log sets of weight × reps, and run an
optional workout timer. Saved workouts act as templates you can load into a day with one tap,
pre-filled with your last-used weights. A month calendar shows training days at a glance.
Analytics show totals, personal records, and per-exercise weight/volume progression charts.

Everything the original app does, Rippy Rippy does — but each user (me + friends allowlisted by
email) signs in with Google and gets their own private data, synced to the server, usable from
any device.

## 2. Stack & architecture (= buckos pattern)

- **Client:** React 18 + TypeScript + Vite + Tailwind v4, design tokens in `client/src/theme.css`
  copied from THEME.md. React Router. No chart library — port the existing inline SVG charts.
- **Server:** Express + TypeScript. `server/config.ts` validates all env at startup (fail fast,
  readable errors). `buildApp(deps)` takes injected `{config, repo, clock}` so tests run against
  a temp DB.
- **Storage:** SQLite (better-sqlite3) behind a `Repo` interface, file at `DATABASE_PATH`
  (`/app/data/rippy.db` in production, Docker volume `rippy-rippy_data`).
- **Auth:** copy buckos verbatim — `AUTH_MODE=dev|google`, server-side Google OAuth with state
  check, `cookie-session` (httpOnly, sameSite lax, 30 days), `revalidateSession` middleware,
  `/api/me` always 200 with `{user: null}` when logged out, friendly `/not-allowed` page.
- **Port:** 3001 internally. Vite dev server on 5173 proxying `/api` and `/auth` to 3001.
- **Scripts:** `dev`, `build`, `start`, `seed`, `test`, `test:e2e`, `typecheck` — same shape as
  `buckos/package.json`.
- **Health:** `GET /api/health` → `{"ok":true}`.

## 3. Users & access

- **`ALLOWED_EMAILS`** (env): comma-separated Google account emails allowed to sign in — me and
  my friends. Everyone is a plain user; there are no roles or admin. Anyone not on the list gets
  the "you're not on the list" page.
- All data (days, saved workouts, settings, profile) is **per-user and private**. Every API route
  requires a session and scopes queries to the session user's id. There is no way to read or
  write another user's data — enforce and test this.
- `AUTH_MODE=dev` shows a pick-a-user screen listing `ALLOWED_EMAILS` (no Google needed); the
  rest of the app is identical to production.

## 4. Profile, avatar & account menu (= buckos UX)

- **Top header, always visible:** app wordmark ("Rippy Rippy" in `--font-serif`) on the left, a
  **circular avatar button on the top right**. Clicking it opens a small menu: **Settings** and
  **Log out**.
- Avatar resolution order: user-uploaded picture → Google profile picture → initials fallback.
  On Google login, capture `payload.picture` and store it (like buckos `recordGooglePicture`).
- **Settings page** includes a profile section: shows the current avatar, lets the user upload
  their own picture (client-side crop to square like buckos' AvatarPicker/react-easy-crop, sent
  as a small data URL ≤ 2 MB JSON limit), or **revert to the Google picture** ("Use my Google
  photo"). Display name defaults to the Google name and is editable.
- `/api/me` returns `{ user: { email, name, avatar } }` with avatar resolved fresh (never store
  images in the cookie).

## 5. Functional spec (port of workout-app, per screen)

Navigation: bottom tab bar on mobile (**Today · Workouts · Analytics · Settings**) — this is a
gym app used one-handed on a phone; keep the bottom nav from the original. Sub-screens (Library,
Exercise detail) sit under Settings for nav-highlight purposes, as in the original. Desktop gets
the same layout centered at a comfortable max-width.

### 5.1 Day screen (default, "Today")

- Header row: previous/next day arrows, date title ("Today" when today, else "Monday, Jul 6"),
  a "Today" jump button when not on today, and a month-view toggle.
- Optional **workout name label** when a saved workout was loaded into the day.
- **Exercise cards**, in user-defined order (move up/down buttons):
  - name + library pills (movement pattern, muscle group, type, equipment, calisthenics)
  - "Last: 185 lb × 8" from the most recent *earlier* session, with a trend arrow (↑/↓/→
    comparing max weight across the last 3 sessions); "First time!" when new
  - set rows: `Set N  [weight] lb × [reps]  ✕`, numeric inputs, edits persist as you type
    (debounced); remove set; **+ Add Set** duplicates the previous set (or last session's)
  - remove exercise
- **Add Exercise** button → modal with search over all known names (library + user's history),
  excluding ones already on the day; shows last weight + trend per suggestion; free-text
  "Add \"Bulgarian Curl\"" creates a new exercise name. Adding pre-fills one set from the last
  session when available.
- **Load Workout** button → picker of saved workouts; loading sets the day's workout name and
  replaces the day's exercises, each pre-filled with last-used weights.
- **Save Workout** button → saves the day's exercise list as a named template (updates existing
  template with the same name, case-insensitive).
- **Workout timer** per day: start / stop / reset, HH:MM:SS display, accumulates across
  start/stop cycles, survives reload and device switch (timer state is part of the day record;
  elapsed time computed from timestamps, never from an in-memory counter).

### 5.2 Month view

- Calendar grid (Sun–Sat), dots on days that have exercises, today highlighted, selected day
  highlighted, prev/next month, "Today" button when viewing another month. Tapping a day opens
  it in the Day screen (including adjacent-month cells).

### 5.3 Workouts screen

- List of saved workouts (name + exercise list preview), create new, edit (rename, add/remove/
  reorder exercises via the same search modal), delete. Same behavior as original.

### 5.4 Analytics screen

- Summary cards: total workout days, unique exercises, best day-streak.
- Personal records: top 5 exercises by max weight ever logged.
- **Progression charts** (port the inline SVG implementation): user picks exercises via chips
  (add from search modal, remove from chip); two charts — max weight over time and total volume
  (Σ weight×reps) over time; multi-series with per-exercise colors, gradient area fills, dots,
  y-grid + date x-labels. Chart series colors come from the theme's `--s1`…`--s8` (replace the
  original's hardcoded neon palette). Axis/grid/label colors from theme tokens.

### 5.5 Exercise library

- Ship `default-library.json` (103 exercises with description, movementPattern, muscleGroup,
  exerciseType, equipment, calisthenics, alternatives) as **server-seeded global read-only
  data**, served via `GET /api/library`. Store the library version; on startup, if the bundled
  default's version is newer than the DB's, refresh it (fixes the original's stale-forever
  localStorage cache).
- Library browser (from Settings): search + filter chips (movement, muscle, type, equipment,
  calisthenics), count, list with pills → **exercise detail** page: description, pills,
  tappable alternatives that cross-link to other library entries.
- The original's library import/export UI is **dropped** (global library is server-managed).

### 5.6 Settings screen

- **Profile** (see §4): avatar, name.
- **Weight unit:** lb / kg toggle. As in the original, the unit is a display label, not a
  conversion — numbers are stored as entered.
- **Exercise library** entry point (browse).
- **Data export:** download all of my data (days, saved workouts, settings) as JSON.
- **Import from Workout Book:** paste or upload the old app's localStorage JSON (`wb_days`,
  `wb_saved_workouts`, `wb_settings`) and import it into my account (merge by date; imported
  day replaces an empty existing day, otherwise ask/skip — keep the rule simple and documented).
  This is how I migrate my real history off my phone.
- **Developer mode** toggle (per-user): reveals dev tools — generate N days of realistic test
  data ending today (port the generator), generate the six sample saved workouts, and a
  danger-zone "reset all my data" with confirmation. Server-side endpoints, scoped to the
  current user only.
- **Log out** (also in the avatar menu).

### 5.7 Login / NotAllowed

- Login page: wordmark + "Sign in with Google" (google mode) or user picker (dev mode).
- NotAllowed page: friendly "you're not on the list" with a sign-out link.

## 6. Data model (server, SQLite)

```
users:            id, email (unique, lowercase), name, google_picture, avatar (data URL, nullable),
                  created_at
days:             id, user_id, date (YYYY-MM-DD, unique per user), workout_name,
                  timer_state ('idle'|'running'|'stopped'), timer_started_at, timer_elapsed_ms,
                  timer_stopped_at
exercises:        id, day_id, position, exercise_name
sets:             id, exercise_id, position, weight (real), reps (int)
saved_workouts:   id, user_id, name, exercises (JSON array of names), position/created_at
user_settings:    user_id, weight_unit ('lb'|'kg'), dev_mode (bool)
library:          version + exercises (seeded from default-library.json)
```

(Exact normalization is the implementer's call — days may store exercises/sets as a JSON column
instead of child tables if simpler; the API contract below is what matters. Keep dates and
"last session" logic in server-agnostic pure functions with unit tests.)

**API sketch** (all under session auth, user-scoped):

```
GET  /api/me                         auth/logout/google — copy buckos
GET  /api/days?from=&to=             summaries for month dots + analytics
GET  /api/days/:date                 full day record (404 → client treats as empty day)
PUT  /api/days/:date                 upsert full day record (client debounces ~500ms)
GET  /api/exercise-stats?name=       last session, trend, history (server computes; used by
                                     day cards, suggestions, analytics)
GET/POST/PUT/DELETE /api/workouts    saved workout CRUD
GET/PUT /api/settings                weight unit, dev mode
PUT  /api/profile                    name, avatar (or {useGooglePhoto: true})
GET  /api/library                    the exercise library
GET  /api/export                     my full data as JSON
POST /api/import                     Workout Book localStorage payload
POST /api/dev/generate-days          dev-mode only: {startDate, count≤90}
POST /api/dev/generate-workouts      dev-mode only
POST /api/dev/reset                  dev-mode only, current user only
```

**Sync model:** the server is the source of truth. The client keeps the current day in memory,
applies edits optimistically, and PUTs the day debounced (~500 ms) plus a flush on
`visibilitychange`/page hide. Failed writes retry with backoff and surface a subtle "offline —
retrying" indicator. No service worker / offline mode in v1.

## 7. Known bugs in the original — fix these in the port

1. **"Last session" ignores date order.** `getLastSession`/`getTrend` walk `state.days` in
   array (insertion) order and only exclude the *current* date, so days created out of order —
   or dated in the future — corrupt "last" and trend values. Fix: consider only days strictly
   before the viewed date, ordered by date.
2. **Stored XSS via names.** Exercise/workout names are interpolated into `innerHTML` and into
   HTML attributes unescaped. React escapes by default — keep it that way (no
   `dangerouslySetInnerHTML` with user strings), and validate/trim names server-side (length
   cap ~80 chars, reject empty).
3. **Library never updates.** The default library is cached in localStorage once; new versions
   of `default-library.json` are ignored forever. Fixed by §5.5 server-side versioned seeding.
4. **Library import gives no feedback and doesn't re-render.** Moot — import UI dropped.
5. **Hardcoded neon chart colors** clash with the theme. Use `--s1`…`--s8` and theme grid/label
   tokens (§5.4).
6. **Set inputs coerce to 0 while typing** (`parseFloat(value) || 0` on every input event).
   Allow an empty field while editing; commit 0 only on blur/flush. Preserve decimals (2.5 lb
   plates exist).
7. **Timer display drifts across screens** — timer interval is display-only in the original and
   elapsed time is timestamp-derived; preserve that property (it's what makes cross-device
   timers work).

Improvements that are in scope because they're cheap: PWA installability (manifest + icons +
`theme-color` matching `--page`; no service worker), `apple-mobile-web-app` meta so it feels
native from the home screen, and empty-state copy on every screen.

Out of scope for v1: sharing/social features, offline mode, push notifications, weight-unit
conversion, migrating the old GHCR/Hostinger-Docker-Manager deployment (the old workout-app
stays untouched; Rippy Rippy is a new app).

## 8. Theme & branding

- Follow [`../THEME.md`](../THEME.md) exactly: token block into `theme.css`, all styling via
  `var(--…)`, Anthropic Sans/Serif stacks, cards/chips/pills/toggles/tables per the recipes.
  Light theme only in v1 (the original's dark mode is dropped; the tokens make it easy to add
  later).
- Wordmark: "Rippy Rippy" in `--font-serif`, 600. Keep branding minimal — the theme is the
  brand. Favicon/manifest icon: a simple dumbbell or "R" mark in `--accent` on `--page`.
- Mobile-first: bottom tab bar (respect `env(safe-area-inset-bottom)`), 44px+ touch targets,
  numeric keyboards on set inputs (`inputmode="decimal"` / `"numeric"`).

## 9. Testing & quality bar (definition of done)

Mirror buckos' test layout: `tests/unit/`, `tests/api/` (Vitest + Supertest), `tests/e2e/`
(Playwright, builds the app first).

- **Unit:** date helpers; last-session/trend logic (incl. bug #1 regression cases: out-of-order
  insertion, future dates); streak/stats; PR computation; set-group compaction; timer elapsed
  math; Workout Book import mapping.
- **API:** every endpoint; the **authorization matrix** (unauthenticated → 401/redirect; user A
  cannot read/write user B's days/workouts/settings/profile — test explicitly); validation
  (bad dates, oversized names, dev endpoints rejected when devMode off).
- **E2E (Playwright, dev auth mode):** log-a-workout flow (add exercise → sets → edit → reload
  → persisted); saved workout create/load with pre-filled weights; month view dots + navigation;
  analytics with generated data; settings: unit toggle, avatar upload + revert to Google photo,
  name change; account menu log out; two-user isolation (log in as A, create data, log in as B,
  sees none of it); mobile viewport (iPhone-sized) for the core flow.
- **Green means:** `npm run typecheck` && `npm test` && `npm run test:e2e` && `npm run build`
  all pass, and `docker build .` succeeds.

## 10. Deliverables checklist

Everything in [`../ADDING-AN-APP.md`](../ADDING-AN-APP.md) §"What every app must have", i.e.:

- [x] `rippy-rippy/` app: client, server, tests, seed script, this SPEC.md kept up to date
- [x] Multi-stage `Dockerfile` (node:22-slim, like buckos), `.dockerignore`
- [x] `.env.example` (dev: `AUTH_MODE=dev`, `ALLOWED_EMAILS=jorgeper@gmail.com,friend@gmail.com`,
      annotated) and `.env.cloud.example` (google mode, `APP_ORIGIN=https://rippy-rippy.jorgepereira.io`)
- [x] `docker-compose.yml`: `rippy-rippy` service (`env_file: ${RIPPY_RIPPY_ENV_FILE:-rippy-rippy/.env}`,
      volume `rippy-rippy_data:/app/data`) + caddy `depends_on`
- [x] `Caddyfile`: `rippy-rippy.jorgepereira.io { reverse_proxy rippy-rippy:3001 }`
- [x] `rippy-rippy/README.md` per the README conventions (quick start, scripts, config, OAuth
      setup, VPS deployment incl. Porkbun DNS A record `rippy-rippy`, redeploy commands, backup)
- [x] Root `README.md` updated: services table row, deploy section, README link
- [x] All tests green per §9 (see DECISIONS.md for choices made where the spec left room)
