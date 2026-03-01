# jorgepereira.io

## Project structure

```
jorgepereira.io/
  Caddyfile        # Caddy web server config
  Dockerfile       # Builds the container image
  html/            # Website content served by Caddy
    index.html
    demos.html
    wind.html
    wisy.html
```

## Build and run locally

```bash
cd jorgepereira.io
docker build -t jorgepereira-io .
docker run -d -p 3000:80 --name jorgepereira-io jorgepereira-io
```

Open http://localhost:3000 in your browser to test the site.

ACME/Let's Encrypt errors in the logs are expected locally since Caddy cannot obtain a certificate without a public-facing domain. The site still works over HTTP.

If your browser redirects `localhost:3000` to HTTPS, use an incognito/private window.

### Redeploy locally after changes

```bash
docker rm -f jorgepereira-io && docker build -t jorgepereira-io . && docker run -d -p 3000:80 --name jorgepereira-io jorgepereira-io
```

## Pushing updates

When you make changes to the site, commit and push to `main`. The Docker image is hosted on GitHub Container Registry at `ghcr.io/jorgeper/jorgepereira-io:latest`.

A GitHub Actions workflow automatically builds and pushes a new image when files in `jorgepereira.io/` change on the `main` branch. You can also trigger it manually:

### Option 1: From the CLI

```bash
gh workflow run docker-publish.yml
```

Watch the progress:

```bash
gh run watch
```

### Option 2: From the GitHub UI

1. Go to **github.com/jorgeper/sandbox**
2. Click the **Actions** tab
3. Select **"Build and push Docker image"** on the left
4. Click **"Run workflow"** on the right
5. Select the `main` branch and click **"Run workflow"**

### After the image is published

Make sure the package is public so Hostinger can pull it:

1. Go to **github.com/jorgeper?tab=packages**
2. Click **jorgepereira-io**
3. Go to **Package settings** > change visibility to **Public**

This only needs to be done once.

## Deploy on Hostinger VPS

In the Hostinger Docker Manager, create a container with these settings:

| Field | Value |
|---|---|
| **Project name** | `jorgepereira-io` |
| **Container name** | `jorgepereira-io` |
| **Image** | `ghcr.io/jorgeper/jorgepereira-io:latest` |
| **Port** | `80:80/tcp` |
| **Port** | `443:443/tcp` |
| **Volume** | `caddy_data:/data` |
| **Restart policy** | `unless-stopped` |

Leave **Container dependency** empty.

The `caddy_data` volume stores the Let's Encrypt certificates so they persist across restarts.

To redeploy after pushing a new image, pull the latest image and restart the container from Hostinger's Docker Manager.

## HTTPS

HTTPS is handled automatically by Caddy via Let's Encrypt. Make sure your domain's DNS A record points to your Hostinger VPS IP address before deploying. Caddy will obtain and renew certificates automatically.

## How it all works

The HTML files are the actual website. They get packaged into a Docker container image along with Caddy (the web server). From there, the image can go two ways: run locally for testing, or pushed to a registry and deployed to the VPS for production.

```
                        ┌─────────────────┐
                        │   HTML files +   │
                        │   Caddyfile +    │
                        │   Dockerfile     │
                        └────────┬────────┘
                                 │
                           docker build
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Docker Image   │
                        │ jorgepereira-io │
                        └───────┬─┬───────┘
                                │ │
                 ┌──────────────┘ └──────────────┐
                 │                                │
          LOCAL TESTING                    PRODUCTION
                 │                                │
          docker run                     git push to main
          -p 3000:80                              │
                 │                                ▼
                 ▼                   ┌──────────────────────┐
        ┌─────────────────┐         │   GitHub Actions      │
        │ localhost:3000  │         │   builds & pushes to  │
        │ (HTTP only)     │         │   GitHub Container    │
        └─────────────────┘         │   Registry (ghcr.io)  │
                                    └──────────┬───────────┘
                                               │
                                          docker pull
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │   Hostinger VPS       │
                                    │   ports 80 + 443      │
                                    │   Caddy auto-HTTPS    │
                                    │                       │
                                    │   jorgepereira.io     │
                                    └──────────────────────┘
```

**Local flow:** Edit HTML → `docker build` → `docker run` → test at `localhost:3000`. No registry involved, the image stays on your machine.

**Production flow:** Edit HTML → `git push` → GitHub Actions builds the image and pushes it to `ghcr.io` → pull the new image on the Hostinger VPS → restart the container. Caddy handles HTTPS automatically.
