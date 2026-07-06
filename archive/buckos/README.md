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

## Deploying to a VPS

**Requires Node 20+** (Tailwind v4's native tooling won't run on Node 18). On Ubuntu/Debian the
distro Node is usually too old — install Node 22 LTS first:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v22.x
```

```bash
git clone <your-repo> && cd buckos
npm ci
cp .env.example .env      # set AUTH_MODE=google, PARENT_EMAILS, secrets, APP_ORIGIN
npm run build
npm start                 # or run under systemd/pm2 so it restarts on boot
```

The production server serves both the API and the built client from a single port, so a reverse
proxy just forwards everything:

```nginx
server {
  server_name buckos.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Use HTTPS (e.g. certbot) — Google OAuth requires a secure origin in production. Back up the SQLite
file at `DATABASE_PATH` to keep your family's history safe.

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
