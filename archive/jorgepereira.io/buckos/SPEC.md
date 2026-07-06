# Buckos — Family Behavior Currency App

## 1. Overview

Buckos is a web app for families. Each kid has a weekly allowance of "Buckos" (a virtual currency). Parents add or withdraw Buckos based on behavior, with a note explaining why. Every transaction goes into a ledger. Balances reset to a configurable amount every week. Kids can log in to view (read-only) their balance, a 7-day chart, and their transaction history.

The app must be polished, modern, and mobile-friendly. It will be developed and tested locally first, then deployed to a VPS.

## 2. Tech Stack

- **Frontend:** React (Vite), modern component patterns, TypeScript.
- **Styling:** Tailwind CSS with a design-token layer (CSS variables) so the app is **themable** (see Design section).
- **Backend:** Node.js (Express or similar lightweight server) with TypeScript, serving a REST API and the built frontend.
- **Storage:** SQLite by default (via better-sqlite3 or Drizzle ORM). **Important:** implement a clean storage abstraction (repository/interface layer) so the storage backend can be swapped later (e.g., Postgres/Supabase) without touching business logic.
- **Auth:** Google OAuth 2.0 (Sign in with Google).
- **Charts:** A lightweight chart library (e.g., Recharts) for the 7-day bar chart.
- Must run locally with a single command (e.g., `npm run dev`) and have a production build/start path suitable for a VPS (e.g., `npm run build && npm start`). Include a README with setup instructions for both.

### Local development without Google credentials
The build agent will not have real Google OAuth credentials. Implement a **dev auth mode** (enabled via `AUTH_MODE=dev` in `.env`) that presents a simple "pick a user" login screen (choose any email from the allowlist) so the full app can be run and tested end-to-end locally and in automated tests. `AUTH_MODE=google` enables real Google OAuth for production. The rest of the app must be identical in both modes.

## 3. Users, Roles, and Access Control

- Allowed users are controlled by the server environment (`.env`):
  - `PARENT_EMAILS` — comma-separated list of Gmail addresses with the **parent (admin)** role. (This includes both parents.)
  - Kid access: a Google account may log in as a **kid** only if a parent has created a kid profile with that Gmail address.
- Anyone signing in with an email that is neither a parent email nor a registered kid email is rejected with a friendly "You're not on the list" screen.
- Roles:
  - **Parent:** full admin — manage kids, configure rules, add/withdraw Buckos, view everything.
  - **Kid:** read-only view of their own data only. Kids must never be able to see other kids' data or reach any parent/admin route or API endpoint (enforce on the server, not just in the UI).

## 4. Screens & Flows

### 4.1 Login screen
- Branded "Buckos" landing screen: logo/wordmark, playful tagline, and a "Sign in with Google" button (or the dev-mode user picker).
- Clean, welcoming, kid-friendly but tasteful.

### 4.2 Parent experience

**First run / empty state:** After login, if no kids exist, show a friendly empty state with an "Add your first kid" call to action.

**Parent dashboard:** The home screen for parents. For each kid, show a card with:
- Kid's name and avatar (auto-generated from initials is fine).
- **Current Bucko balance**, large and prominent.
- A **7-day bar chart** showing their end-of-day balance for the last 7 days (including today's current balance as the last bar; highlight the current day).
- **Add Buckos** and **Withdraw Buckos** buttons.

**Add / Withdraw flow:** Tapping Add or Withdraw opens a modal/sheet:
- Amount (positive integer), required.
- Note / reason (e.g., "Helped with dishes", "Hit his brother"), required.
- On submit, creates a ledger entry with: kid, signed amount (+/-), note, timestamp, and which parent did it.
- Balance updates immediately. Balances **may go negative** (kids can go into Bucko debt).

**Kid detail view:** Tapping a kid's card opens their detail page: balance, 7-day chart, and the full scrollable transaction ledger (date, amount with clear +/- color coding, note, and weekly-reset entries).

**Manage kids:**
- **Add kid:** form with name and Gmail address → creates the kid profile (and thereby authorizes that Google account to log in as a kid). Also set their **weekly allowance** (default 100).
- **Edit kid:** change name, Gmail, and weekly allowance.
- **Remove kid:** with a confirmation dialog. (Soft-delete or archive is fine; their history doesn't need to be recoverable in the UI.)

**Log out** available from a simple account menu.

### 4.3 Kid experience (read-only)
After a kid logs in they see a single, simple, delightful page:
1. **Balance** at the top, big and celebratory.
2. **7-day timeline** bar chart below it.
3. **Transaction list**: scrollable ledger of their own transactions (date, +/- amount, note), newest first.

No edit actions of any kind. No navigation to admin areas.

## 5. Core Rules & Logic

- **Weekly reset:** Every kid's balance resets to their configured weekly allowance at the start of each week — **Monday 00:00 server local time** (make the reset day/time a server config value). The reset is recorded in the ledger as a system entry (e.g., "Weekly reset to 100") so history is never ambiguous.
  - Implement resets robustly for a small server: compute lazily on access and/or via a scheduled job, but ensure correctness even if the server was asleep/down over the reset boundary (catch up missed resets).
- **Ledger is the source of truth:** the current balance is derivable from the ledger. Transactions are immutable (no editing/deleting entries in v1).
- **7-day chart data:** end-of-day balance for each of the last 7 days, derived from the ledger.
- All amounts are whole numbers.

## 6. Design & Theming

- Aesthetic inspired by Claude.ai: warm off-white/cream backgrounds, soft dark-charcoal text, a restrained accent color (warm coral/terracotta), generous whitespace, rounded corners, subtle shadows, and elegant serif-ish display font for headings with a clean sans for body text (use tasteful Google Fonts approximations).
- **Themability:** all colors, fonts, radii, and spacing tokens defined as CSS variables in one theme file. Ship the default "Claude-like" theme, and structure it so a second theme could be added by defining another token set. (A visible theme switcher is NOT required in v1 — just the architecture.)
- Fully responsive: must look and work great on a phone (parents will use it primarily on mobile) and on desktop. Touch-friendly tap targets.
- Delightful micro-details welcome: subtle transitions, a pleasant empty state, maybe a tiny celebration when Buckos are added. Keep it tasteful.

## 7. Non-Functional Requirements

- Mobile-first responsive layout; test at 375px, 768px, and 1280px widths.
- Server-side enforcement of all authorization rules (role checks on every API route).
- Sensible error handling and loading states throughout; no unhandled promise rejections or console errors.
- Config via `.env` (`PARENT_EMAILS`, `AUTH_MODE`, Google OAuth client ID/secret, session secret, database path, reset day/time, port). Provide `.env.example`.
- Seed script (`npm run seed`) that creates 2–3 demo kids with a week of varied transaction history, for local testing and screenshots.
- README covering: local setup, dev auth mode, creating Google OAuth credentials, and VPS deployment (build, start, reverse proxy note).

## 8. Testing & Quality Requirements

- **Unit tests** for all core logic: balance computation from ledger, weekly reset (including missed/multiple-week catch-up), 7-day chart data derivation, allowlist/role resolution.
- **API tests** for every endpoint, including authorization failures (kid hitting parent endpoints must get 403).
- **End-to-end tests (Playwright)** using dev auth mode, covering at minimum:
  - Parent logs in, adds a kid, adds Buckos with a note, withdraws Buckos, sees balance and ledger update.
  - Weekly reset behavior (simulate time or inject clock).
  - Kid logs in, sees only their own read-only view; verify no admin controls are reachable.
  - Unauthorized email is rejected.
  - Mobile viewport smoke test.
- All tests must pass. The app must build with no TypeScript errors and run cleanly.

## 9. Definition of Done

The project is complete only when ALL of the following are true:
1. Every feature in sections 3–6 is implemented.
2. Full test suite (unit + API + e2e) passes.
3. `npm run dev` brings up a working app in dev auth mode with seed data; the entire parent and kid flows work when clicked through manually.
4. Production build succeeds and can be started with documented commands.
5. UI is polished and responsive — no placeholder/unstyled screens.
6. README and `.env.example` are complete and accurate.

## 10. Out of Scope (v1 — do not build)

- Paying off negative balances with screen time (future feature; the negative-balance data model should support it later).
- End-of-week positive-balance bonuses.
- Push notifications or emails.
- Multiple families / multi-tenancy.
- Theme switcher UI (architecture only).
