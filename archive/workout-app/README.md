# Workout Book

A vanilla JS workout tracking app. No frameworks, no dependencies — just HTML, CSS, and JavaScript with localStorage for data persistence.

## Build and run locally

```bash
cd workout-app
docker build -t workout-app .
docker run -d -p 3001:80 --name workout-app workout-app
```

Open http://localhost:3001 in your browser (or on your iPhone on the same network, use your Mac's local IP).

### Redeploy locally after changes

```bash
docker rm -f workout-app && docker build -t workout-app . && docker run -d -p 3001:80 --name workout-app workout-app
```

### Without Docker

```bash
cd workout-app
python -m http.server 8000
```

## Pushing updates

Commit and push to `main`. A GitHub Actions workflow automatically builds and pushes a new image to `ghcr.io/jorgeper/workout-app:latest` when files in `workout-app/` change.

You can also trigger it manually:

```bash
gh workflow run workout-app-publish.yml
gh run watch
```

### Make the package public (first time only)

1. Go to **github.com/jorgeper?tab=packages**
2. Click **workout-app**
3. Go to **Package settings** > change visibility to **Public**

## Deploy on Hostinger VPS

In the Hostinger Docker Manager, create a container:

| Field | Value |
|---|---|
| **Project name** | `workout-app` |
| **Container name** | `workout-app` |
| **Image** | `ghcr.io/jorgeper/workout-app:latest` |
| **Port** | `80:80/tcp` |
| **Restart policy** | `unless-stopped` |

To redeploy after pushing a new image, pull the latest image and restart the container from Hostinger's Docker Manager.

### Custom domain with HTTPS

If you want to serve under a domain (e.g. `workout.jorgepereira.io`):

1. Point the DNS A record to your Hostinger VPS IP
2. Update the `Caddyfile` to add the domain block:

```
workout.jorgepereira.io {
    root * /srv
    file_server
}
```

3. Map port `443:443/tcp` and add a volume `caddy_data:/data` in the Docker Manager so Caddy can store Let's Encrypt certificates.

## iPhone usage

Open the URL in Safari and tap **Share > Add to Home Screen**. The app runs full-screen and stores all data in your browser's localStorage.
