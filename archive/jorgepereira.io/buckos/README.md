# Buckos 🪙

A family behavior-currency app. Each kid gets a weekly allowance of **Buckos**; parents give or
take Buckos for behavior, always with a note. Every movement lands in an immutable ledger, balances
reset to the allowance every Monday, and kids get a read-only view of their balance, their week,
and their history.

Built with React + Vite + Tailwind (design-token theming), an Express + TypeScript API, and SQLite
behind a repository interface so the storage backend can be swapped later.

## Quick start (local, no Google account needed)

```bash
npm install
cp .env.example .env      # defaults are ready for dev mode
npm run seed              # 3 demo kids with a week of history
npm run dev               # client on http://localhost:5173, API on :3000
```

Open http://localhost:5173 and pick a user. `AUTH_MODE=dev` shows a "pick a user" login screen —
parents come from `PARENT_EMAILS`, kids appear once a parent adds them. The rest of the app is
identical to production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + API with hot reload |
| `npm run seed` | Reset the database with demo kids and history |
| `npm test` | Unit + API tests (Vitest + Supertest) |
| `npm run test:e2e` | Playwright end-to-end suite (builds the app first; needs `npx playwright install chromium` once) |
| `npm run build` | Production build → `dist/server` + `dist/client` |
| `npm start` | Run the production server (serves API + built client on `PORT`) |
| `npm run typecheck` | Type-check client and server |

## Configuration (`.env`)

See [.env.example](.env.example) for the full annotated list:

- `PARENT_EMAILS` — comma-separated Gmail addresses that get the parent (admin) role.
- `AUTH_MODE` — `dev` (user picker) or `google` (real Sign in with Google).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_ORIGIN` — required for `google` mode.
- `SESSION_SECRET` — cookie signing secret (`openssl rand -hex 32`).
- `DATABASE_PATH` — SQLite file location (created on first run).
- `RESET_DAY` / `RESET_HOUR` — weekly reset boundary (default Monday 00:00, server local time).
- `PORT` — server port (default 3000).

Access control: an email can sign in only if it's in `PARENT_EMAILS` **or** a parent created a kid
profile with it. Everyone else gets a friendly "you're not on the list" screen. All role checks are
enforced server-side on every API route.

## How the ledger works

The ledger is the source of truth — the balance is always `SUM(amount)` over a kid's entries, and
entries are immutable. Weekly resets are ledger entries too ("Weekly reset to 100"), stamped at the
Monday-00:00 boundary. Resets are computed lazily on access, so a server that slept through several
Mondays writes one catch-up entry per missed week at the correct historical timestamps. Balances
may go negative (Bucko debt), and the data model keeps that intact for future features.

## Creating Google OAuth credentials (production)

1. In [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type **Web application**.
2. Add your app origin (e.g. `https://buckos.example.com`) to **Authorized JavaScript origins**.
3. Add `https://buckos.example.com/auth/google/callback` to **Authorized redirect URIs**.
4. Put the client ID/secret in `.env`, set `AUTH_MODE=google` and `APP_ORIGIN=https://buckos.example.com`.

## VPS deployment (Docker + Caddy)

Buckos lives inside the [jorgepereira.io](../README.md) stack and deploys as one more service:
Caddy terminates HTTPS and reverse-proxies `buckos.jorgepereira.io` to the `buckos` container,
which builds and runs the app on its own Node 22 (the host's Node version doesn't matter). The
SQLite database lives in the `buckos_data` Docker volume.

```
Browser → https://buckos.jorgepereira.io → Caddy → buckos:3000 (plain HTTP)
```

The pieces (already in the repo, all under `jorgepereira.io/`):
- `buckos/Dockerfile` — multi-stage build, slim runtime image, `node dist/server/index.js`
- `buckos/.env.cloud.example` — production config template
- `docker-compose.yml` — the `buckos` service + `buckos_data` volume
- `Caddyfile` — the `buckos.jorgepereira.io` block

### One-time setup

**1. DNS:** in Porkbun, add an A record `buckos` → your VPS IP (same as `jorgepereira.io`).
Verify with `dig buckos.jorgepereira.io +short`.

**2. Google OAuth:** create credentials (section above) with
`https://buckos.jorgepereira.io` as the origin and
`https://buckos.jorgepereira.io/auth/google/callback` as the redirect URI.

**3. Configure the environment on the VPS:**

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io
cp buckos/.env.cloud.example buckos/.env.cloud
nano buckos/.env.cloud     # PARENT_EMAILS, Google client id/secret, SESSION_SECRET
```

Generate the session secret with `openssl rand -hex 32`. Leave `DATABASE_PATH=/app/data/buckos.db`
as is — that's the volume mount.

**4. Point docker-compose at the env file:**

```bash
cd /opt/sandbox/jorgepereira.io
echo "BUCKOS_ENV_FILE=buckos/.env.cloud" >> .env
```

**5. Build and start:**

```bash
docker-compose up -d --build buckos
docker-compose restart caddy    # picks up the new Caddyfile block + gets the certificate
```

**6. Verify:**

```bash
docker-compose ps
curl https://buckos.jorgepereira.io/api/health   # {"ok":true}
```

Then open https://buckos.jorgepereira.io and sign in with a parent Google account.

### Deploying Buckos changes

After pushing changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io
docker rm -f $(docker ps -aq --filter name=buckos)
docker-compose up -d --build buckos
```

(The `docker rm -f` sidesteps docker-compose v1's `KeyError: 'ContainerConfig'` bug when
recreating containers — same as the other services. Data is safe in the `buckos_data` volume.)

### Useful commands

```bash
docker-compose logs -f buckos      # follow app logs
docker-compose restart buckos      # restart the app (data persists in the volume)
# Back up the family's history:
docker run --rm -v jorgepereiraio_buckos_data:/data -v "$PWD":/backup alpine \
  cp /data/buckos.db /backup/buckos-backup.db
```

### Without Docker

`npm ci && npm run build && npm start` works on any box with **Node 20+** (Tailwind v4 won't run
on Node 18) — put a reverse proxy with HTTPS in front; Google OAuth requires a secure origin.

## Theming

Every color, font, radius, and shadow lives as a CSS variable in
[`client/src/theme.css`](client/src/theme.css). The default theme is the warm cream/terracotta
look; a second theme is one more `:root[data-theme='…']` token block — no component changes needed.

## Project layout

```
server/          Express API — config, clock, db, repo (storage interface), ledger, routes
client/src/      React app — pages, components, theme.css design tokens
tests/unit/      ledger, repo, role resolution
tests/api/       every endpoint incl. the authorization matrix
tests/e2e/       Playwright: parent flow, kid read-only view, weekly reset, mobile
```
