# Playground — Architecture

## Overview

A lightweight app at `playground.jorgepereira.io` that hosts multiple standalone mini-apps (demos, tools, experiments). The shell handles only two things: **authentication** and **a directory of apps**. It knows nothing about what each sub-app is — it just reads `meta.json` files and routes traffic.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Server | Express (TypeScript) | Handles OAuth + serves everything |
| Home page | React (Vite) | Directory UI, built to static files |
| Sub-apps | Anything | Each app is independent — React, static HTML, whatever |
| Container | Docker (node:22-slim) | Consistent with deployment pattern |
| Reverse proxy | Caddy (shared) | Automatic HTTPS, already in place |

**Auth libraries:**
- **arctic** — Modern, TypeScript-native Google OAuth client. Handles authorization URL generation, token exchange, and PKCE automatically. Certified-compatible with Google's OpenID Connect flow.
- **cookie-parser** — Parses and signs cookies via HMAC-SHA256 (stateless, same pattern as hank-web's `itsdangerous`).

Why arctic over passport: Passport is widely used but carries legacy baggage (callback-based, requires strategy plugins, session serialization boilerplate). Arctic is purpose-built for modern OAuth, handles PKCE by default, and produces less code with the same security guarantees.

## Routing

```
playground.jorgepereira.io
├── /                       → Home page (directory of apps, requires auth)
├── /login                  → Google OAuth redirect (stores returnTo in cookie)
├── /auth/callback          → OAuth callback (redirects to returnTo or /)
├── /logout                 → Clear session
├── /health                 → Health check (unauthenticated)
└── /<slug>/*               → Sub-app files (requires auth, unless public)
```

All routes except `/login`, `/auth/callback`, `/logout`, and `/health` require authentication. Public apps (flagged in `meta.json`) skip the auth check.

### Auth on Direct Navigation

If a user navigates directly to `playground.jorgepereira.io/valheim-colors` without a session:

1. Auth middleware intercepts the request (runs before static file serving)
2. No valid session cookie → redirect to `/login?returnTo=/valheim-colors`
3. `/login` stores `returnTo` in a short-lived signed cookie, redirects to Google
4. After OAuth, `/auth/callback` reads the `returnTo` cookie and redirects there
5. User lands at `/valheim-colors` with a valid session

This works for any depth: `/valheim-colors`, `/valheim-colors/some/page`, etc.

## Sub-App Convention

Each sub-app lives in `playground/apps/<name>/` and must have a `meta.json`:

```json
{
  "slug": "valheim-colors",
  "title": "Valheim Colors",
  "description": "Color palette tool for Valheim builds",
  "public": false
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | yes | URL path segment — `playground.jorgepereira.io/<slug>` |
| `title` | yes | Display name on the home page |
| `description` | no | Short description shown on the home page |
| `public` | no | If `true`, accessible without auth. Default `false` |

The sub-app folder can contain anything: pre-built React app output, plain HTML/CSS/JS, a single `index.html`, whatever. The server serves the entire folder as static files at `/<slug>/`.

### How the Shell Works

1. On startup, scans `apps/*/meta.json` to build a registry of apps
2. For each app, mounts `apps/<name>/` as static files at `/<slug>/` (behind auth middleware)
3. The home page (`/`) renders the registry as a card grid with links
4. Clicking a card navigates to `/<slug>/` which serves the sub-app

The shell never builds, compiles, or inspects the sub-app contents. It just serves files.

## Folder Structure

```
playground/
├── apps/                        # Sub-apps live here
│   └── hello-world/
│       ├── meta.json
│       └── index.html
├── home/                        # Home page React app (Vite source)
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx
│   └── style.css
├── src/                         # Server source (TypeScript)
│   ├── server.ts                # Express server, app discovery, static serving
│   └── auth.ts                  # Google OAuth + session + allow-list
├── Dockerfile
├── package.json
├── tsconfig.json                # Compiles src/ → dist/server/
├── vite.config.ts               # Builds home/ → dist/home/
├── .env.local.example
├── .env.cloud.example
├── identities.json              # Allow-list of Google accounts
├── architecture.md              # This file
└── README.md
```

Build output:
- `dist/server/` — compiled Express server (from `src/`)
- `dist/home/` — built home page assets (from `home/`, served at `/`)
- `apps/` — sub-apps served at `/<slug>/` (no build, just copied into Docker image)
- `identities.json` — copied into Docker image at `/app/identities.json`

## Authentication

Same model as hank-web, adapted to Express + arctic:

1. User visits any protected route → redirected to `/login?returnTo=<original-path>`
2. `/login` stores `returnTo` in a signed cookie, creates Google OAuth URL with PKCE, redirects
3. Google calls back `/auth/callback` with authorization code
4. Server exchanges code for tokens via arctic, extracts email from ID token
5. Email checked against `identities.json` (baked into the Docker image)
6. If allowed → signed session cookie (`playground_session`, 7-day TTL), redirect to `returnTo`
7. If not allowed → 403

Cookie config: `httpOnly`, `secure`, `sameSite: "lax"`, signed with `SESSION_SECRET`.

### Allow-List

The allow-list is `playground/identities.json`, committed to the repo and baked into the Docker image. To add or remove allowed users, edit the file, commit, and redeploy.

Format:

```json
[
  {
    "id": "jorge",
    "name": "Jorge",
    "emails": ["jorgeper@gmail.com"]
  }
]
```

The server builds an email→identity lookup on startup. Only emails in this file can log in.

## Infrastructure Changes

### Caddyfile (add block)

```
playground.jorgepereira.io {
    reverse_proxy playground:8002
}
```

### docker-compose.yml (add service)

```yaml
playground:
  build: playground
  env_file: ${PLAYGROUND_ENV_FILE:-playground/.env.local}
  restart: unless-stopped
```

### DNS

Add `A` record: `playground.jorgepereira.io` → VPS IP (Porkbun).

### Google OAuth

In Google Cloud Console, add to the existing OAuth client:
- Authorized JavaScript origins: `https://playground.jorgepereira.io`
- Authorized redirect URIs: `https://playground.jorgepereira.io/auth/callback`

## Environment Variables

```bash
GOOGLE_CLIENT_ID=...              # Same as hank-web (same OAuth client)
GOOGLE_CLIENT_SECRET=...          # Same as hank-web
SESSION_SECRET=...                # New secret (openssl rand -hex 32)
PORT=8002                         # Internal port
IDENTITIES_FILE=identities.json
```

## Deployment

Same GitOps flow as the rest of the repo:

```bash
ssh jorge@<vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker compose up -d --build playground
```

Caddy picks up the new subdomain automatically and issues a Let's Encrypt certificate.

Detailed setup, inner-loop, and "add a new app" instructions are in the [README](README.md).
