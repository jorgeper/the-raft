# Adding a new app to jorgepereira.io

How to build and deploy a new web app at `<app>.jorgepereira.io`, using the same pattern as the
existing apps. **[`buckos/`](buckos) is the reference implementation** — when this doc and the code
disagree, read buckos and fix this doc.

If you're building with Claude Code, [`CLAUDE.md`](CLAUDE.md) tells it to follow this document.

## The big picture

One Hostinger VPS runs everything under `jorgepereira.io` as Docker containers, managed by the
single [`docker-compose.yml`](docker-compose.yml) in this directory. **Caddy** is the only
container exposed to the internet (ports 80/443); it gets Let's Encrypt certificates
automatically and reverse-proxies each subdomain to its app container over plain HTTP:

```
Browser → https://foo.jorgepereira.io → Caddy (TLS) → foo container :<port> (plain HTTP)
```

Apps never deal with HTTPS. Each app is a self-contained directory here with its own Dockerfile,
env files, README, and (if it needs persistence) a named Docker volume.

Current internal port allocations (each app has its own container, so clashes aren't fatal, but
keep them unique for sanity):

| App | Subdomain | Internal port |
|---|---|---|
| site | jorgepereira.io | 80 |
| hank | hank.jorgepereira.io | 8000 |
| hank-web | hank.jorgepereira.io (paths) | 8001 |
| playground | playground.jorgepereira.io | 8002 |
| buckos | buckos.jorgepereira.io | 3000 |

## What every app must have

Whatever the stack, an app `foo` provides:

1. **A self-contained `foo/` directory** — code, `Dockerfile`, env templates, `README.md`.
2. **A multi-stage `Dockerfile`** — build stage compiles, runtime stage is slim and runs the
   server on one internal port. The container builds the app itself, so the VPS host's
   Node/Python version never matters. See [`buckos/Dockerfile`](buckos/Dockerfile).
3. **A health endpoint** — `GET /api/health` returning `{"ok":true}`, used to verify deploys.
4. **Env file convention:**
   - `foo/.env.example` — annotated dev defaults, committed. Copy to `.env` locally.
   - `foo/.env.cloud.example` — production template, committed with empty secrets.
   - `foo/.env.cloud` — real production values, created **only on the VPS**, never committed.
   - docker-compose reads `env_file: ${FOO_ENV_FILE:-foo/.env}`; the VPS `.env` file sets
     `FOO_ENV_FILE=foo/.env.cloud`.
5. **Persistent data in a named volume** mounted at `/app/data` (SQLite file there is the
   default). Containers are disposable; volumes survive redeploys.
6. **`trust proxy` enabled** (or the framework equivalent) — the app sits behind Caddy and must
   trust `X-Forwarded-*` headers so secure cookies and origin checks work.
7. **The shared look and feel** — [`THEME.md`](THEME.md) defines the default theme for every
   app here (claude.ai-inspired off-whites, terracotta accent, the full token set and component
   recipes). Copy its token block into the app's `theme.css` and build on `var(--…)` tokens only.
8. **A `README.md`** following the [README conventions](#readme-conventions) below, plus a row
   and deploy section in the root [`README.md`](README.md).

## The buckos application architecture (recommended for new apps)

Buckos is the pattern to copy for a real web app with sign-in. Stack: **React + Vite + Tailwind v4**
client, **Express + TypeScript** server, **SQLite** (better-sqlite3) behind a repository
interface, one npm package for both.

```
foo/
├── Dockerfile             # multi-stage: npm ci → npm run build → slim node runtime
├── .env.example           # dev config (AUTH_MODE=dev)
├── .env.cloud.example     # prod template (AUTH_MODE=google)
├── package.json           # dev/build/start/test/typecheck scripts
├── vite.config.mts        # client root, dev proxy for /api and /auth → :3000
├── server/
│   ├── index.ts           # entry: loadConfig() → buildApp() → listen
│   ├── config.ts          # ALL env parsing + validation, fail fast with clear errors
│   ├── app.ts             # buildApp(deps) — express app assembled from injected deps
│   ├── db.ts / repo.ts / sqliteRepo.ts   # storage behind an interface
│   ├── authz.ts           # who is allowed + what role, resolved from email
│   └── routes/            # auth.ts + one file per feature area
├── client/src/
│   ├── theme.css          # every color/font/radius as CSS variables (design tokens)
│   ├── auth.tsx           # session context, fetches /api/me
│   ├── api.ts             # typed fetch wrappers
│   └── pages/, components/
└── tests/                 # unit/ + api/ (Vitest + Supertest) + e2e/ (Playwright)
```

Key decisions that make this pattern pleasant:

- **`buildApp(deps)` takes injected config/repo/clock** — tests build an app with a temp
  database and fake clock; no globals.
- **`config.ts` validates everything at startup** and throws readable errors ("SESSION_SECRET is
  required (generate one with: openssl rand -hex 32)").
- **Dev and prod are the same app**: `npm run dev` runs `tsx watch` for the server plus the Vite
  dev server, with Vite proxying `/api` and `/auth` to the server. In production the server
  serves the built client from `dist/client` with an SPA fallback that excludes `/api/` and
  `/auth/`.
- **Design tokens in `theme.css`** — a second theme is one more `:root[data-theme='…']` block.
  New apps start from the shared token set in [`THEME.md`](THEME.md) rather than inventing one.

### The auth pattern (Google sign-in + allowlist)

This is the part worth copying verbatim from [`buckos/server/routes/auth.ts`](buckos/server/routes/auth.ts):

- **`AUTH_MODE=dev | google`.** Dev mode shows a "pick a user" screen and needs no Google
  credentials — the rest of the app is identical to production. Google mode does real
  server-side OAuth (`google-auth-library`): `/auth/google` redirects with a random `state`
  stored in the session; `/auth/google/callback` checks the state, exchanges the code, verifies
  the ID token, and resolves the email.
- **Authorization = an email allowlist resolved server-side.** Config lists admin emails
  (`PARENT_EMAILS` in buckos); other users can be added via the app's own data (buckos kids).
  Anyone else is redirected to a friendly `/not-allowed` page. Every role check happens on the
  server, on every route — the client only decides what to render.
- **Sessions are signed cookies** (`cookie-session`, `httpOnly`, `sameSite: 'lax'`, 30 days,
  `SESSION_SECRET`). No server-side session store to manage.
- **Re-validate the session on every request** (`revalidateSession` middleware): permissions can
  change while a cookie is still valid, so the email is re-resolved and stale sessions dropped.
- **`/api/me` always returns 200** with `{user: null}` when logged out — being logged out is a
  normal state, not an error.

### Creating Google OAuth credentials

1. [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials)
   → create an **OAuth client ID**, type **Web application**.
2. **Authorized JavaScript origins:** `https://foo.jorgepereira.io`
3. **Authorized redirect URIs:** `https://foo.jorgepereira.io/auth/google/callback`
4. Put the client ID/secret in `.env.cloud`, with `AUTH_MODE=google` and
   `APP_ORIGIN=https://foo.jorgepereira.io`.

## Step by step: shipping `foo.jorgepereira.io`

### 1. Build the app locally

Scaffold `foo/` following the layout above (or copy buckos and gut the domain logic). Get to a
working `npm run dev` with `AUTH_MODE=dev`, tests, and `npm run build && npm start` serving the
built app on its port.

### 2. Wire it into the stack (committed to the repo)

Add the service and volume to [`docker-compose.yml`](docker-compose.yml):

```yaml
  foo:
    build: foo
    env_file: ${FOO_ENV_FILE:-foo/.env}
    restart: unless-stopped
    volumes:
      - foo_data:/app/data

volumes:
  foo_data:
```

Also add `foo` to the `depends_on` list of the `caddy` service, and add a block to the
[`Caddyfile`](Caddyfile):

```
foo.jorgepereira.io {
	reverse_proxy foo:3000
}
```

### 3. DNS

In [Porkbun](https://porkbun.com) → Domain Management → DNS for `jorgepereira.io`, add an
**A record**: name `foo`, pointing to the VPS IP (same as `jorgepereira.io`). Verify:

```bash
dig foo.jorgepereira.io +short   # → VPS IP
```

### 4. Configure and deploy on the VPS

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io

cp foo/.env.cloud.example foo/.env.cloud
nano foo/.env.cloud                          # fill secrets; openssl rand -hex 32 for SESSION_SECRET
echo "FOO_ENV_FILE=foo/.env.cloud" >> .env   # point compose at the cloud env

docker-compose up -d --build foo
docker-compose restart caddy                 # load the new Caddyfile block + fetch the certificate
```

### 5. Verify

```bash
docker-compose ps
curl https://foo.jorgepereira.io/api/health   # {"ok":true}
```

Then open https://foo.jorgepereira.io in a browser and sign in.

### 6. Update the docs

- Write `foo/README.md` (conventions below).
- Root [`README.md`](README.md): add a row to the services table, a "Deploying foo changes"
  section, and link `foo/README.md`.

## README conventions

Each app's `README.md` is its complete manual, in this order (see
[`buckos/README.md`](buckos/README.md) for the canonical example):

1. **What it is** — two or three sentences, plus the stack.
2. **Quick start (local)** — copy-paste commands to a running dev app, no cloud accounts needed.
3. **Scripts** — table of npm scripts.
4. **Configuration** — every `.env` variable, pointing at `.env.example`.
5. **Domain-specific docs** — how the app's core logic works.
6. **Google OAuth setup** — if the app has sign-in.
7. **VPS deployment** — one-time setup (DNS, OAuth, `.env.cloud`, compose env pointer, build,
   verify) and a "Deploying changes" section with the exact redeploy commands.
8. **Useful commands** — logs, restart, data backup.

The root `README.md` stays the overview of the whole stack: what runs, how Caddy/compose/HTTPS
work, one-time VPS setup, and per-service redeploy commands — linking to each app's README for
the details.

## Redeploying and day-2 operations

After pushing changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox && git pull
cd jorgepereira.io
docker rm -f $(docker ps -aq --filter name=foo)   # see gotcha below
docker-compose up -d --build foo
```

Or use [`redeploy.sh`](redeploy.sh), which does exactly that and follows the logs:
`./redeploy.sh foo`.

**Gotchas learned the hard way:**

- **docker-compose v1 `KeyError: 'ContainerConfig'`** — the VPS's docker-compose v1 crashes when
  recreating a running container. Always `docker rm -f` the old container first (all the deploy
  snippets and `redeploy.sh` do this). Data is safe — it lives in the named volume.
- **Caddy only reads the Caddyfile at start** — after changing it, `docker-compose restart caddy`.
  Certificates for new subdomains are fetched automatically on first request.
- **DNS before Caddy** — Caddy can't get a certificate until the A record resolves, so do the
  Porkbun step first.

```bash
docker-compose ps               # status of everything
docker-compose logs -f foo      # follow app logs
docker-compose restart foo      # restart (volume data persists)
# Back up a SQLite volume:
docker run --rm -v jorgepereiraio_foo_data:/data -v "$PWD":/backup alpine \
  cp /data/foo.db /backup/foo-backup.db
```
