# Valheim Colors

A tool for creating and managing Valheim sign color code sheets. Organize color codes into groups, click to copy the full Valheim markup (e.g. `<#d3d4d3>Stone/Flint🪨`), and share sheets with friends via public read-only links.

## Features

- **Sheets** — Create, duplicate, rename, and delete color code sheets
- **Groups** — Organize colors into named groups arranged in columns
- **Click to copy** — Click any color entry to copy the full Valheim sign code to clipboard
- **Live color preview** — Text renders in the actual color parsed from the code
- **Edit mode** — Add, rename, and delete groups and colors inline
- **Sharing** — Generate a public read-only link anyone can access without logging in
- **Default sheet** — Every new user starts with a pre-populated sheet based on the community's Valheim Sign Codes 2.0

## Color Format

Valheim signs use two color syntaxes. Both are supported:

- `<#RRGGBB>Label` — hex color (e.g. `<#d3d4d3>Stone/Flint🪨`)
- `<color=name>Label` — named color (yellow, red, green, white, grey, blue)

The full text including the color tag is what gets copied to clipboard and pasted into Valheim signs.

## Data Storage

Sheets are stored server-side in SQLite via the API in `api/`. Each user's sheets are scoped to their Google account. The database persists across container restarts via a Docker volume.

## Project Structure

Everything for this app lives in this directory:

- **`src/`** — React frontend (pages, components, styles)
- **`api/`** — Backend (SQLite store + Express routes)
- **`default-sheet.json`** — Pre-populated sheet data for new users

The playground server auto-discovers `api/routes.ts` and mounts it at `/api/valheim-colors/`. Auth is handled by the playground shell and passed to the API routes as a dependency.

## Local Development

### Prerequisites

- Node.js 22+
- Playground deps installed (`cd playground && npm install`)

### First-Time Setup

```bash
cd playground/apps/valheim-colors
npm install
```

Create the playground env file (from the playground root):

```bash
cd playground
cp .env.local.example .env.local
```

Edit `playground/.env.local`:

```bash
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
SESSION_SECRET=dev-secret-change-in-production
PORT=8002
IDENTITIES_FILE=identities.json
DB_PATH=playground.db
NODE_ENV=development
```

You also need to configure the Google OAuth client for local dev. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), open the OAuth 2.0 client and add:

- **Authorized JavaScript origins:** `http://localhost:8002`
- **Authorized redirect URIs:** `http://localhost:8002/auth/callback`

### Run

Two terminals from this directory:

```bash
# Terminal 1: server (auth + API)
npm run dev:server

# Terminal 2: frontend (Vite HMR)
npm run dev
```

Open `http://localhost:5173/valheim-colors/`. Vite proxies API calls and auth routes to the server on port 8002.

**Or** if you don't need HMR, just build and serve everything from one terminal:

```bash
npm run build
npm run dev:server
```

### First Login

Before the app works, you need a session cookie. With the server running, visit `http://localhost:8002/login` in your browser. This takes you through Google OAuth and sets the `playground_session` cookie on `localhost`. After that, the Vite dev server on port 5173 will also work (same domain, shared cookie). The cookie lasts 7 days.

### Inner Loop

| What changed | What to do |
|---|---|
| Frontend (`src/`) | Automatic with Vite HMR, or `npm run build` + refresh |
| API (`api/`) | Restart the playground server (it loads routes on startup) |
| `default-sheet.json` | `npm run build` (bundled into JS) |

## Deployment

After pushing changes:

```bash
ssh jorge@<vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker compose up -d --build playground
```

The Dockerfile builds valheim-colors as part of the playground image — no separate deploy step needed.

## File Structure

```
apps/valheim-colors/
├── api/                     # Backend (auto-mounted by playground server)
│   ├── routes.ts            # Express router (sheets CRUD + sharing)
│   ├── store.ts             # SQLite store
│   └── tsconfig.json        # Server compilation config
├── src/                     # Frontend (React SPA)
│   ├── main.tsx
│   ├── App.tsx              # Router
│   ├── api.ts               # API client (fetch wrappers)
│   ├── colors.ts            # Valheim color parser
│   ├── types.ts
│   ├── style.css
│   ├── pages/
│   │   ├── SheetsList.tsx   # Sheets directory
│   │   ├── SheetEditor.tsx  # Sheet view + edit
│   │   └── SharedView.tsx   # Public read-only view
│   └── components/
│       ├── GroupCard.tsx     # Group with color list
│       ├── ColorItem.tsx    # Single color entry
│       └── Toast.tsx        # Notification toast
├── meta.json                # App metadata for playground directory
├── default-sheet.json       # Pre-populated sheet for new users
├── package.json
├── tsconfig.json            # Frontend type-checking
├── vite.config.ts
├── index.html               # Vite entry
├── architecture.md          # Design doc
├── valheim-codes.html       # Original reference file
└── dist/                    # Frontend build output (gitignored)
```
