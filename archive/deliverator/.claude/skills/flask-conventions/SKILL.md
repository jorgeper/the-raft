---
name: flask-conventions
description: Use this whenever writing or modifying Flask application code — routes, blueprints, app factory, models, config, or tests. Enforces the app-factory pattern, blueprint structure, env-based config, SQLAlchemy model conventions, and hermetic OAuth test mocking. Apply it to every Flask change, not just new files.
allowed-tools: Read, Write, Edit, Bash
---

<!-- Stack-specific skill: this one serves the Flask labs. Building on a
     different stack? Replace this skill with your stack's conventions
     (e.g. express-conventions, rails-conventions) and update the coder's
     trigger keywords in orchestrator/skills.py. -->

# Flask conventions

## App structure (app factory)
- `app/__init__.py` exposes `create_app(config=None)`; register blueprints there.
- Group routes into blueprints by concern: `app/auth.py` (login/callback/logout), feature blueprints elsewhere.
- No module-level work at import time — everything through the factory so tests build isolated apps.

## Config & secrets
- Read all secrets/config from env vars inside the factory (GOOGLE_CLIENT_ID/SECRET, FLASK_SECRET_KEY, DATABASE_URL).
- Never hard-code or commit secrets. Provide `.env.example` with placeholders.

## Models (SQLAlchemy)
- Key users on the stable OAuth `sub` claim, not email.
- `created_at` defaults to now. Add fields via clear, reversible changes.

## Routes
- Explicit status codes. Validate input; reject bad input with a 4xx and a clear message.
- Protect login-required routes with a shared check/decorator; anonymous requests must be rejected.

## Tests (hermetic)
- Flask test client; build via `create_app()` with a test config and a throwaway SQLite DB.
- NEVER call Google in tests — mock the provider so CI never hits the network.
- Every route and every branch (valid, invalid, unauthorized) gets a test.

## Before finishing
Run the inner loop (see run-inner-loop): install, lint, test — all green before any PR.
