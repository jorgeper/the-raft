# jorgepereira.io

Everything that runs under the `jorgepereira.io` domain. Right now that is the static website only;
the apps that used to live on subdomains (hank, buckos, playground, rippy-rippy) are kept in this
repo as code but are **not deployed** (torn down from the VPS in September 2026).

**Adding a new app?** Follow [ADDING-AN-APP.md](ADDING-AN-APP.md) — the full pattern (app
architecture, Google auth, Caddy/compose/DNS wiring, deployment, README conventions).

## Architecture

```
Internet
  │
  ▼
┌────────────────────────────────────────────────┐
│  Caddy (ports 80 + 443)                        │
│  Automatic HTTPS via Let's Encrypt             │
│                                                │
│  jorgepereira.io  →  site container :80        │
└────────────────────────────────────────────────┘
```

Docker containers managed by docker-compose, one per service:

| Service | What it does | Internal port | Deployed? | Docs |
|---------|-------------|---------------|-----------|------|
| **caddy** | Reverse proxy + HTTPS termination | 80, 443 (exposed) | yes | — |
| **site** | Static website (nginx) | 80 (internal) | yes | — |
| hank | Telegram bot (FastAPI) | 8000 | no | [hank/README.md](hank/README.md) |
| hank-web | Memory browser web UI for hank (FastAPI) | 8001 | no | [hank/README.md](hank/README.md) |
| buckos | Family Ƀuckos app (Express + React) — the reference implementation for new apps | 3000 | no | [buckos/README.md](buckos/README.md) |
| playground | Mini-apps playground | 8002 | no | [playground/README.md](playground/README.md) |
| rippy-rippy | Workout tracker for friends (Express + React) | 3001 | no | [rippy-rippy/README.md](rippy-rippy/README.md) |

To deploy one of the undeployed apps again, add its service + volume back to `docker-compose.yml`,
its block to the `Caddyfile`, and its DNS A record, as described in
[ADDING-AN-APP.md](ADDING-AN-APP.md).

## How HTTPS and the reverse proxy work

HTTPS encrypts traffic between the browser and the server. To prove the server is legitimate, it needs a **certificate** signed by a trusted authority (like Let's Encrypt).

**Caddy** is a web server that handles all of this automatically:
1. It requests a certificate from Let's Encrypt for each domain in the Caddyfile
2. It proves ownership by responding to a challenge on port 80
3. It serves traffic over HTTPS on port 443
4. It renews certificates before they expire

**Reverse proxy** means Caddy sits in front of the other containers and forwards requests based on the domain name:

```
Browser → https://jorgepereira.io → Caddy → (decrypts) → site:80 (plain HTTP)
```

The app containers never deal with HTTPS — they serve plain HTTP internally. Caddy handles all the encryption. This is configured in the `Caddyfile`:

```
jorgepereira.io {
    reverse_proxy site:80
}
```

Docker networking lets Caddy reach the other containers by service name (`site`).

## Project structure

```
jorgepereira.io/
├── Caddyfile              # Shared Caddy config — routes domains to services
├── docker-compose.yml     # Deployed services (caddy + site)
├── redeploy.sh            # Rebuild + restart a service on the VPS
├── ADDING-AN-APP.md       # The pattern for building/deploying a new app here
├── THEME.md               # Shared look & feel (design tokens) every app starts from
├── CLAUDE.md              # Points Claude Code at the pattern when building apps
├── site/                  # jorgepereira.io static website (deployed)
│   ├── Dockerfile         # nginx serving static files
│   └── html/
│       ├── index.html
│       ├── demos.html
│       ├── wind.html
│       └── wisy.html
├── buckos/                # family app — reference implementation, not deployed
├── hank/                  # Telegram bot — not deployed
├── hank-web/              # hank memory browser UI — not deployed
├── playground/            # mini-apps — not deployed
└── rippy-rippy/           # workout tracker — not deployed
```

## Local development

### Run the site only

```bash
cd site
docker build -t jorgepereira-site .
docker run -d -p 3000:80 --name jorgepereira-site jorgepereira-site
```

Open http://localhost:3000

### Run everything with docker-compose

```bash
docker-compose up --build
```

Locally, Caddy won't be able to get certificates (no public domain), but the site still answers at
http://localhost:80.

## VPS deployment (Hostinger)

### One-time setup

Do this once to get the VPS ready.

**Prerequisites:**
- Hostinger VPS with SSH access
- Docker and Docker Compose installed
- An A record for `jorgepereira.io` in Porkbun pointing at the VPS IP

**1. Clone the repo:**

```bash
ssh jorge@<your-vps-ip>
sudo git clone https://github.com/jorgeper/sandbox.git /opt/sandbox
sudo chown -R jorge:jorge /opt/sandbox
cd /opt/sandbox/jorgepereira.io
```

**2. Start everything:**

```bash
docker-compose up -d --build
```

Caddy will automatically obtain a Let's Encrypt certificate for the domain.

**3. Verify:**

```bash
docker-compose ps
curl -I https://jorgepereira.io
```

---

### Deploying site changes

After pushing HTML changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
./redeploy.sh site
```

`redeploy.sh` does `docker rm -f` before `docker-compose up -d --build` because the VPS runs
docker-compose v1, which crashes with `KeyError: 'ContainerConfig'` when recreating a container.

### Deploying Caddy config changes

After pushing Caddyfile changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker-compose restart caddy
```

Caddy only reads the Caddyfile at start, so a restart is required.

---

### Useful commands

```bash
docker-compose ps                  # status of all services
docker-compose logs -f site        # follow site logs
docker-compose logs -f caddy       # follow Caddy logs
docker-compose restart site        # restart just the site
```

## Adding a new service

**Read [ADDING-AN-APP.md](ADDING-AN-APP.md)** — the full pattern for building and shipping a new
app at `foo.jorgepereira.io`, with [`buckos/`](buckos) as the reference implementation. The short
version:

1. Build the app in a self-contained `foo/` directory: multi-stage Dockerfile, `/api/health`
   endpoint, `.env.example` + `.env.cloud.example`, data in a volume at `/app/data`
2. Add the service (and its volume) to `docker-compose.yml`, and add it to `caddy.depends_on`
3. Add a block to the `Caddyfile`:
   ```
   foo.jorgepereira.io {
       reverse_proxy foo:<port>
   }
   ```
4. Add a DNS A record for `foo` in Porkbun pointing to the VPS
5. On the VPS: create `foo/.env.cloud`, add `FOO_ENV_FILE=foo/.env.cloud` to `.env`, then
   `docker-compose up -d --build foo && docker-compose restart caddy` — Caddy gets the
   certificate automatically
6. Write `foo/README.md` and update this README (services table + deploy section)
