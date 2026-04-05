#!/bin/bash
# Redeploy a service (or all services) and follow logs.
# Usage:
#   ./redeploy.sh hank     # redeploy just hank
#   ./redeploy.sh site     # redeploy just site
#   ./redeploy.sh          # redeploy everything

SERVICE=$1

if [ -n "$SERVICE" ]; then
    echo "==> Removing old $SERVICE container..."
    docker rm -f $(docker ps -aq --filter name=$SERVICE) 2>/dev/null
    echo "==> Rebuilding and starting $SERVICE..."
    docker-compose up -d --build $SERVICE
    echo "==> Following $SERVICE logs (Ctrl+C to stop)..."
    docker-compose logs -f $SERVICE
else
    echo "==> Removing all containers..."
    docker-compose down
    echo "==> Rebuilding and starting all services..."
    docker-compose up -d --build
    echo "==> Following logs (Ctrl+C to stop)..."
    docker-compose logs -f
fi
