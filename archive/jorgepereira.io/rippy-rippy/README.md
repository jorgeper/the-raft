# Rippy Rippy 🏋️

A workout tracking app for me and my friends — the server-backed rebrand of the old
localStorage-only "Workout Book". Each day is a page in your training book: add exercises (from a
103-exercise built-in library or free-typed), log sets of weight × reps, and run a workout timer.
Saved workouts are one-tap templates pre-filled with your last weights; a month calendar shows
training days; analytics chart your records and progression. Everyone signs in with Google and
gets their own private data, synced to the server and usable from any device.

Built with React + Vite + Tailwind (design tokens from [THEME.md](../THEME.md)), an Express +
TypeScript API, and SQLite behind a repository interface — the
[jorgepereira.io app pattern](../ADDING-AN-APP.md), with [buckos](../buckos) as the sibling
reference.

## Quick start (local, no Google account needed)

```bash
npm install
cp .env.example .env      # defaults are ready for dev mode
npm run seed              # a month of realistic history + sample workouts
npm run dev               # client on http://localhost:5174, API on :3001
```

Open http://localhost:5174 and pick a user. `AUTH_MODE=dev` shows a "pick a user" login screen —
users come from `ALLOWED_EMAILS`. The rest of the app is identical to production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + API with hot reload |
| `npm run seed` | Reset the database with a month of demo history |
| `npm test` | Unit + API tests (Vitest + Supertest) |
| `npm run test:e2e` | Playwright end-to-end suite (builds the app first; needs `npx playwright install chromium` once) |
| `npm run build` | Production build → `dist/server` + `dist/client` |
| `npm start` | Run the production server (serves API + built client on `PORT`) |
| `npm run typecheck` | Type-check client and server |

## Configuration (`.env`)

See [.env.example](.env.example) for the full annotated list:

- `ALLOWED_EMAILS` — comma-separated Google account emails that can sign in (**this is how you
  invite friends** — add their Gmail address, redeploy, done). Everyone gets their own private
  workout data; there are no roles or admins.
- `AUTH_MODE` — `dev` (user picker) or `google` (real Sign in with Google).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_ORIGIN` — required for `google` mode.
- `SESSION_SECRET` — cookie signing secret (`openssl rand -hex 32`).
- `DATABASE_PATH` — SQLite file location (created on first run).
- `PORT` — server port (default 3001).

All authorization is enforced server-side on every API route: a user can only ever read or write
their own days, workouts, settings, and profile (there's an API test matrix proving it).

## How it works

- **A day is the unit of sync.** The client edits the current day in memory, PUTs it debounced
  (~500 ms) with a keepalive flush when the tab hides, and retries with backoff — the server is
  the source of truth. Untouched days are never stored.
- **"Last session" and trends** are computed server-side over days strictly *before* the viewed
  date, sorted by date — so editing an old day or planning a future one never corrupts history.
- **The timer survives anything.** Elapsed time is derived from stored timestamps, never an
  in-memory counter, so reloading or switching devices mid-workout keeps the clock honest.
- **The exercise library is global and versioned.** `default-library.json` seeds the database at
  startup and refreshes automatically when its version is newer.
- **Profile photos** work like buckos: your Google photo by default, or upload and crop your own
  from Settings (stored as a small data URL; "Use my Google photo" reverts).
- **Migrating from the old Workout Book:** Settings → "Import from Workout Book…" accepts the old
  app's localStorage JSON (`wb_days`, `wb_saved_workouts`, `wb_settings`) — export it from the old
  app's browser console with
  `JSON.stringify({wb_days: JSON.parse(localStorage.wb_days||"[]"), wb_saved_workouts: JSON.parse(localStorage.wb_saved_workouts||"[]"), wb_settings: JSON.parse(localStorage.wb_settings||"{}")})`.
  Days you already logged in Rippy Rippy are never overwritten.

## Creating Google OAuth credentials (production)

1. In [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type **Web application**.
2. Add `https://rippy-rippy.jorgepereira.io` to **Authorized JavaScript origins**.
3. Add `https://rippy-rippy.jorgepereira.io/auth/google/callback` to **Authorized redirect URIs**.
4. Put the client ID/secret in `.env.cloud`, with `AUTH_MODE=google` and
   `APP_ORIGIN=https://rippy-rippy.jorgepereira.io`.

## VPS deployment (Docker + Caddy)

Rippy Rippy lives inside the [jorgepereira.io](../README.md) stack and deploys as one more
service: Caddy terminates HTTPS and reverse-proxies `rippy-rippy.jorgepereira.io` to the
`rippy-rippy` container on port 3001. The SQLite database lives in the `rippy-rippy_data` volume.

```
Browser → https://rippy-rippy.jorgepereira.io → Caddy → rippy-rippy:3001 (plain HTTP)
```

### One-time setup

**1. DNS:** in Porkbun, add an A record `rippy-rippy` → the VPS IP (same as `jorgepereira.io`).
Verify with `dig rippy-rippy.jorgepereira.io +short`.

**2. Google OAuth:** create credentials (section above).

**3. Configure the environment on the VPS:**

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io
cp rippy-rippy/.env.cloud.example rippy-rippy/.env.cloud
nano rippy-rippy/.env.cloud     # ALLOWED_EMAILS, Google client id/secret, SESSION_SECRET
echo "RIPPY_RIPPY_ENV_FILE=rippy-rippy/.env.cloud" >> .env
```

**4. Build and start:**

```bash
docker-compose up -d --build rippy-rippy
docker-compose restart caddy    # picks up the new Caddyfile block + gets the certificate
```

**5. Verify:**

```bash
docker-compose ps
curl https://rippy-rippy.jorgepereira.io/api/health   # {"ok":true}
```

Then open https://rippy-rippy.jorgepereira.io, sign in, and on your phone use Safari →
Share → **Add to Home Screen** for the full-screen app.

### Deploying changes

After pushing changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io
docker rm -f $(docker ps -aq --filter name=rippy-rippy)
docker-compose up -d --build rippy-rippy
```

(The `docker rm -f` sidesteps docker-compose v1's `KeyError: 'ContainerConfig'` bug — same as the
other services. Data is safe in the `rippy-rippy_data` volume.)

### Useful commands

```bash
docker-compose logs -f rippy-rippy    # follow app logs
docker-compose restart rippy-rippy    # restart (data persists in the volume)
# Back up everyone's training history:
docker run --rm -v jorgepereiraio_rippy-rippy_data:/data -v "$PWD":/backup alpine \
  cp /data/rippy.db /backup/rippy-backup.db
```

## Project layout

```
server/          Express API — config, db, repo (storage interface), stats, routes
client/src/      React app — pages, components, hooks, theme.css design tokens
client/public/   PWA manifest + icons
tests/unit/      stats (incl. history-corruption regressions), validation, library seeding
tests/api/       every endpoint incl. the two-user authorization matrix
tests/e2e/       Playwright: log-a-workout, templates, analytics, settings, user isolation, mobile
```
