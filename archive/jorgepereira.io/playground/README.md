# Playground

A lightweight app at `playground.jorgepereira.io` that hosts standalone mini-apps behind Google OAuth. The shell handles authentication and a directory page — it knows nothing about what each sub-app is.

See [architecture.md](architecture.md) for design details.

## First-Time Setup

### 1. DNS

Add an `A` record in Porkbun:

```
playground.jorgepereira.io → <VPS IP>
```

### 2. Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create (or reuse) an OAuth 2.0 client and add:

- **Authorized JavaScript origins:** `https://playground.jorgepereira.io`
- **Authorized redirect URIs:** `https://playground.jorgepereira.io/auth/callback`

### 3. Allow-list

Edit `playground/identities.json` to list the Google accounts that can log in:

```json
[
  {
    "id": "jorge",
    "name": "Jorge",
    "emails": ["jorgeper@gmail.com"]
  }
]
```

This file is committed to the repo and baked into the Docker image. To add or remove users, edit it, commit, and redeploy.

### 4. Environment files (on the VPS)

Create the playground env file:

```bash
ssh jorge@<vps-ip>
cd /opt/sandbox/jorgepereira.io
cp playground/.env.cloud.example playground/.env.cloud
```

Edit `playground/.env.cloud`:

```bash
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
SESSION_SECRET=$(openssl rand -hex 32)
PORT=8002
IDENTITIES_FILE=identities.json
DB_PATH=data/playground.db
NODE_ENV=production
```

Then tell Docker Compose to use it. Append this line to the **root** `.env`:

```bash
echo 'PLAYGROUND_ENV_FILE=playground/.env.cloud' >> .env
```

This root `.env` file (`/opt/sandbox/jorgepereira.io/.env`) is where Docker Compose reads variable overrides for each service. It's gitignored — it only exists on the VPS. Without this line, Docker Compose defaults to `playground/.env.local`.

### 5. Deploy

```bash
git pull
docker compose up -d --build playground
```

Caddy picks up the new subdomain and issues a certificate automatically.

## Local Development

### Prerequisites

- Node.js 22+

### Setup

```bash
cd playground
cp .env.local.example .env.local
# Edit .env.local with your Google OAuth credentials
npm install
```

The `identities.json` in the repo root is used for both local dev and production.

### Run

```bash
npm run dev
```

This builds the home page with Vite, then starts the Express server with `tsx watch` (auto-restarts on changes to `src/`).

Open `http://localhost:8002`.

### Inner Loop

| What changed | What to do |
|---|---|
| Server code (`src/`) | Automatic — `tsx watch` restarts the server |
| Home page (`home/`) | Run `npm run build:home`, then refresh |
| Sub-app files (`apps/`) | Just refresh the browser |
| Added a new sub-app | Restart the server (it scans on startup) |

## Adding a New Sub-App

1. Create a folder under `apps/`:

```bash
mkdir apps/my-app
```

2. Add a `meta.json`:

```json
{
  "slug": "my-app",
  "title": "My App",
  "description": "What this app does.",
  "public": false
}
```

3. Add your app files (HTML, JS, CSS, built React app, whatever):

```bash
# Simplest case — a single HTML file
echo '<h1>My App</h1>' > apps/my-app/index.html
```

4. Restart the server (dev) or redeploy (production):

```bash
# Dev
npm run dev

# Production
ssh jorge@<vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker compose up -d --build playground
```

The new app appears in the directory at `playground.jorgepereira.io` and is accessible at `playground.jorgepereira.io/my-app`.

### meta.json Reference

| Field | Required | Default | Description |
|---|---|---|---|
| `slug` | yes | — | URL path: `playground.jorgepereira.io/<slug>` |
| `title` | yes | — | Display name in the directory |
| `description` | no | — | Short description in the directory |
| `public` | no | `false` | If `true`, accessible without login |

## Redeployment

After pushing changes:

```bash
ssh jorge@<vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker compose up -d --build playground
```
