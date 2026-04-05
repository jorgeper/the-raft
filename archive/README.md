# Sandbox

Personal project monorepo.

## Projects

### jorgepereira.io

Everything deployed under the `jorgepereira.io` domain — the static site and the Hank Telegram bot. Uses docker-compose with a shared Caddy reverse proxy for HTTPS.

See [`jorgepereira.io/README.md`](jorgepereira.io/README.md) for full docs.

```bash
cd jorgepereira.io
docker-compose up --build
```

### workout-app

```bash
cd workout-app
docker build -t workout-app .
docker run -d -p 3001:80 --name workout-app workout-app
```

Open http://localhost:3001

Or without Docker: `cd workout-app && python -m http.server 8000`
