# Valheim Colors — Architecture

## Overview

A tool for creating and managing Valheim sign color code sheets. Users create sheets, organize color codes into groups, and click to copy the full Valheim markup (e.g. `<#d3d4d3>Stone/Flint🪨`). Sheets can be shared via read-only links.

## Design

Clean, minimal, modern UI inspired by claude.ai / Anthropic's design language. Think: generous whitespace, subtle borders, smooth transitions, muted color palette for chrome with the Valheim colors popping against a dark background. No heavy gradients or shadows — flat, confident, typographically driven.

Consistent across all pages (sheets list, editor, shared view).

## Pages

### 1. Sheets List (`/valheim-colors/`)

The landing page. Shows all sheets belonging to the current user.

- **Card grid** of sheets (name + group count + last updated)
- **Add sheet** button → creates a new empty sheet, navigates to it
- **Duplicate sheet** → copies an existing sheet (name + " (copy)")
- **Delete sheet** → confirm dialog, then delete
- **Share sheet** → generates a public read-only link, copies to clipboard
- **Click a sheet** → navigates to the sheet editor

### 2. Sheet Editor (`/valheim-colors/sheets/:id`)

The main editing UI. Dark theme, multi-column grid of groups.

**View mode (default):**
- Groups displayed in a multi-column grid (responsive, up to 5 columns)
- Each group has a header and a list of color entries
- Click a color entry → copies the full Valheim code to clipboard, shows toast
- Color text is rendered in the actual color parsed from the code (extract the color value from `<#RRGGBB>` or `<color=name>` and apply it as text color)
- "Edit" button in toolbar to enter edit mode
- "Share" button → generates a public link anyone can access (read-only version of the sheet)

**Edit mode:**
- Toggle on/off via toolbar button
- **Groups:** add new group (button at bottom of each column), rename group (click header), delete group (X button on header)
- **Colors:** add new color (button at bottom of group), edit color (click it — inline edit), delete color (X button)
- As you type a color code, the text color updates live — parse the `<#RRGGBB>` or `<color=name>` prefix and apply that color to the text
- "Save" button appears when there are unsaved changes
- "Cancel" exits edit mode and discards unsaved changes

### 3. Shared View (`/valheim-colors/shared/:token`)

Public read-only view of a shared sheet. No auth required — anyone with the link can see it. Same visual layout as the sheet editor in view mode (click to copy). Shows sheet name and "Shared by [user]" at the top.

## Data Model

A sheet is stored as a single JSON document:

```json
{
  "name": "My Valheim Sheet",
  "columns": [
    [
      {
        "name": "Wood/Stone",
        "colors": [
          "<#d3d4d3>Stone/Flint🪨",
          "<#ffbf95>Wood🪵"
        ]
      },
      {
        "name": "METALS",
        "colors": [
          "<#ffa834>Copper🪨",
          "<#cbcac8>Iron🪨"
        ]
      }
    ],
    [
      {
        "name": "Resources",
        "colors": [
          "<#f6c144>🐗Leather🐗"
        ]
      }
    ]
  ]
}
```

The `columns` array is ordered (column 0, 1, 2, ...). Each column is an array of groups. Each group has a `name` and an array of `colors` (strings — the full Valheim markup). Ordering is implicit in array position.

### Default Sheet

Every new user starts with a pre-populated sheet based on the reference `valheim-codes.html`. This is stored as `default-sheet.json` in the repo and bundled into the frontend build.

When a user first visits the app and has no sheets, the frontend creates their initial sheet by POSTing the contents of `default-sheet.json` to the store API. This happens once — after that, the user can duplicate, edit, or delete it freely.

The default sheet contains 5 columns with 9 groups: Wood/Stone, Metals, Equipment/Fishing, Resources, Food stuff, Portal Names, Boss Portal Names, Borders, Icon, and Workshop Area Below.

## Storage — Generic Document Store

Rather than building valheim-colors-specific API routes, the playground server gets a **generic document store** that any sub-app can use. This keeps the shell app-agnostic.

### Database

**SQLite** via `better-sqlite3` (synchronous, zero-config, single file).

Single table:

```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  app         TEXT NOT NULL,        -- e.g. "valheim-colors"
  user_id     TEXT NOT NULL,        -- from session identity
  data        TEXT NOT NULL,        -- JSON blob
  share_token TEXT UNIQUE,          -- nullable, for sharing
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_docs_app_user ON documents(app, user_id);
CREATE UNIQUE INDEX idx_docs_share ON documents(share_token) WHERE share_token IS NOT NULL;
```

### API Endpoints

All endpoints under `/api/store/` are protected by the same Google OAuth session as the rest of the playground. The existing auth middleware runs before these routes — no valid session cookie means redirect to `/login`.

Each request is scoped to the authenticated user (user_id from session). A user can only read/write their own documents.

```
GET    /api/store/:app              → list docs for this user + app (returns [{id, data, createdAt, updatedAt}])
GET    /api/store/:app/:id          → get one doc
POST   /api/store/:app              → create doc (body: {data}) → returns {id}
PUT    /api/store/:app/:id          → update doc (body: {data})
DELETE /api/store/:app/:id          → delete doc
POST   /api/store/:app/:id/share    → generate share token → returns {token, url}
DELETE /api/store/:app/:id/share    → remove share token

GET    /api/shared/:token           → get shared doc (NO auth — public read-only) → returns {data, app, userName}
```

The `:app` parameter is always `valheim-colors` for this app, but the API is generic.

### Persistence

The SQLite database file lives at `playground.db` in the project root (Docker: `/app/playground.db`). For production, this could be a Docker volume mount for durability, but for a playground this is fine — the data is baked into the container and persists as long as the container isn't rebuilt.

**Durability option:** Add a volume mount for the db file if data should survive rebuilds:
```yaml
volumes:
  - playground_data:/app/data
```
And set the db path to `data/playground.db`.

## Frontend

### Tech

- **React** (Vite build)
- Single-page app with client-side routing (react-router)
- Source lives in `apps/valheim-colors/src/`
- Build output goes to `apps/valheim-colors/dist/` — the playground server serves this directory
- Calls `/api/store/valheim-colors/*` and `/api/shared/*` for persistence

### Color Parsing

Colors are parsed from the Valheim code prefix and applied as CSS text color:

- `<#RRGGBB>` → use `#RRGGBB` directly as the CSS color
- `<color=yellow>` → `#faff00`
- `<color=red>` → `#ff3c3c`
- `<color=green>` → `#00cc00`
- `<color=white>` → `#ffffff`
- `<color=grey>` → `#999999`
- `<color=blue>` → `#4488ff`

The full text (including the color tag) is what gets copied to clipboard and stored. The display just uses the extracted color value for styling.

### Build

```bash
cd apps/valheim-colors
npm install
npm run build    # outputs to dist/
```

The playground Dockerfile needs to build valheim-colors before copying the `apps/` directory.

## Changes to Playground Shell

1. **Add `better-sqlite3`** to playground dependencies
2. **Add `src/store.ts`** — generic document store (SQLite init, CRUD functions)
3. **Add store API routes** to `src/server.ts` — mount `/api/store/` and `/api/shared/` endpoints (protected by existing auth middleware, except `/api/shared/:token` which is public)
4. **Add volume mount** (optional) for db durability in `docker-compose.yml`
5. **Update Dockerfile** to build valheim-colors sub-app

## Folder Structure

```
apps/valheim-colors/
├── meta.json
├── architecture.md          # This file
├── default-sheet.json       # Default sheet for new users (generated from valheim-codes.html)
├── valheim-codes.html       # Reference file (original, not used at runtime)
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx              # Router: sheets list vs sheet editor
│   ├── api.ts               # API client (fetch wrappers)
│   ├── colors.ts            # Valheim color parsing
│   ├── pages/
│   │   ├── SheetsList.tsx   # Sheets list page
│   │   ├── SheetEditor.tsx  # Sheet editor page
│   │   └── SharedView.tsx   # Shared read-only view
│   └── components/
│       ├── GroupCard.tsx     # Group with color list
│       ├── ColorItem.tsx    # Single color entry (click to copy / edit)
│       └── Toast.tsx        # Copy confirmation toast
└── dist/                    # Build output (served by playground)
```
