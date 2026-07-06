# jorgepereira.io

Everything served under the `jorgepereira.io` domain on a Hostinger VPS: one Caddy container
(automatic HTTPS via Let's Encrypt) reverse-proxies each `<app>.jorgepereira.io` subdomain to its
own Docker container, all managed by the `docker-compose.yml` in this directory. One directory per
app (`buckos/`, `hank/`, `playground/`, `site/`, …), each self-contained with its own Dockerfile
and README.

## Building a new app for this domain

**Follow [ADDING-AN-APP.md](ADDING-AN-APP.md)** — it is the canonical pattern: app architecture,
the Google-auth pattern, env-file conventions, docker-compose/Caddyfile/DNS wiring, deployment,
and README conventions. **`buckos/` is the reference implementation**; when in doubt, copy its
structure.

Non-negotiable conventions for a new app `foo` at `foo.jorgepereira.io`:

- Self-contained `foo/` directory with a **multi-stage Dockerfile**; the container serves plain
  HTTP on one internal port — Caddy terminates TLS, so enable `trust proxy`.
- `GET /api/health` → `{"ok":true}`.
- Env files: `foo/.env.example` (dev defaults) and `foo/.env.cloud.example` (prod template) are
  committed; the real `foo/.env.cloud` exists only on the VPS. Compose reads
  `env_file: ${FOO_ENV_FILE:-foo/.env}`.
- Persistent data in a named volume mounted at `/app/data` (SQLite via a repo interface).
- Apps with sign-in copy the buckos auth pattern: `AUTH_MODE=dev|google` (dev = pick-a-user
  screen, no Google needed), server-side Google OAuth, email-allowlist authorization enforced
  server-side on every route, `cookie-session` cookies, session revalidation middleware.
- Wire-up: service + volume in `docker-compose.yml` (and `caddy.depends_on`), a block in
  `Caddyfile`, an A record for `foo` in Porkbun.
- Docs are part of the deliverable: write `foo/README.md` (section order in ADDING-AN-APP.md,
  buckos/README.md is the model) **and** update the root `README.md` (services table, a
  "Deploying foo changes" section, link to the app README).

## Deploy gotchas

- The VPS runs docker-compose **v1**, which crashes with `KeyError: 'ContainerConfig'` when
  recreating a container. Always `docker rm -f $(docker ps -aq --filter name=<svc>)` before
  `docker-compose up -d --build <svc>` — or use `./redeploy.sh <svc>`. Volume data survives.
- Caddy only reads the Caddyfile at start: after changing it, `docker-compose restart caddy`.
- Repo lives at `/opt/sandbox` on the VPS; deploys are `git pull` + rebuild (no registry).
