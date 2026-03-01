# jorgepereira.io

## Build and run locally

```bash
cd jorgepereira.io
docker build -t jorgepereira-io .
docker run -d -p 3000:80 --name jorgepereira-io jorgepereira-io
```

Open http://localhost:3000 in your browser to test the site.

## Deploy on Hostinger VPS

1. SSH into your VPS and clone/copy the `jorgepereira.io` directory
2. Build and run:
   ```bash
   docker build -t jorgepereira-io .
   docker run -d -p 80:80 --restart unless-stopped --name jorgepereira-io jorgepereira-io
   ```

The `--restart unless-stopped` flag ensures the container auto-restarts on reboot.

## HTTPS

To add HTTPS, put a reverse proxy like Caddy or nginx-proxy with Let's Encrypt in front of the container.
