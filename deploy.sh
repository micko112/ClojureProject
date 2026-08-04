#!/usr/bin/env bash
# Zero-touch deploy script for BeBetter — invoked by GitHub Actions via SSH.
# Location on the VPS: /opt/app/deploy.sh
#
# Usage: ./deploy.sh <git-sha>
#   git-sha — image tag to pull from GHCR. Falls back to :latest.

set -euo pipefail

REPO_DIR="/opt/app"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE_OWNER="${IMAGE_OWNER:-micko112}"
GIT_SHA="${1:-}"

cd "$REPO_DIR"

echo "▶ [1/6] Sync repo (compose file, nginx conf, transactor Dockerfile)"
git fetch --all --prune
git reset --hard origin/main

echo "▶ [2/6] Choose image tag"
if [ -n "$GIT_SHA" ]; then
  export IMAGE_TAG="$GIT_SHA"
else
  export IMAGE_TAG="latest"
fi
export IMAGE_OWNER
echo "    IMAGE_OWNER=$IMAGE_OWNER"
echo "    IMAGE_TAG=$IMAGE_TAG"

echo "▶ [3/6] Login to GHCR"
ENV_FILE="$REPO_DIR/.env"
GHCR_USER=$(grep -E '^GHCR_USER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
GHCR_TOKEN=$(grep -E '^GHCR_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
if [ -z "$GHCR_TOKEN" ] || [ -z "$GHCR_USER" ]; then
  echo "⚠ GHCR_USER or GHCR_TOKEN missing in $ENV_FILE — skipping login (using cached credentials)"
else
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

echo "▶ [4/6] Pull latest images"
docker compose -f "$COMPOSE_FILE" pull backend frontend datomic

echo "▶ [5/6] Restart services (Datomic untouched to avoid data loss window)"
docker compose -f "$COMPOSE_FILE" up -d --no-deps --remove-orphans backend frontend

# Nginx caches upstream DNS — restart forces it to resolve the new container IPs.
# Without this you can see 502 Bad Gateway right after a deploy.
echo "    Restarting nginx (upstream DNS refresh)..."
docker compose -f "$COMPOSE_FILE" restart nginx

echo "▶ [6/6] Prune dangling images"
docker image prune -f

echo "✓ Deploy done — commit $IMAGE_TAG"
