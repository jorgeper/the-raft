# DECISIONS.md — implementation choices where the spec left room

- **Days are stored as one row per (user, date) with exercises as a JSON column** (SPEC §6
  explicitly allows this). The API contract exchanges whole `DayRecord`s; normalizing sets into
  child tables bought nothing at this scale.
- **No injected clock** (buckos has one for its weekly-reset e2e tests). Rippy Rippy has no
  server-side time-dependent logic — timer elapsed time is computed client-side from stored
  timestamps — so `deps = { config, repo }`.
- **`/api/suggestions` is a single endpoint** returning every known exercise name (library +
  logged history) with last-session and trend, instead of the client stitching together three
  calls when the add-exercise modal opens.
- **Saved-workout POST with an existing name (case-insensitive) updates that workout** — matches
  the original app's "Save workout" semantics, where saving under the same name overwrites.
- **Import merge rule:** an imported day replaces a missing or *empty* existing day; a day that
  already has exercises is skipped (counted in the response). Workouts import skips name
  collisions. Simple and predictable, per SPEC §5.6.
- **`/api/days/:date` returns 404 for an untouched day** and the client treats it as an empty
  day; empty days are only persisted once the user edits something.
- **Internal port 3001** (3000 is buckos), Vite dev port 5174 (5173 is buckos) so both apps can
  run side by side during development.
- **Dev users list** (`/api/auth/dev-users`) shows all `ALLOWED_EMAILS` even before first login,
  with the email prefix as the default display name.
- **Timer regression guard:** elapsed time is always derived from `timerStartedAt` +
  `timerElapsedMs`, never from an in-memory counter, so it survives reloads and device switches.
