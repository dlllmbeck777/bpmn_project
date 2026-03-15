#!/bin/bash
# Full destructive production rebuild.
# Removes all project containers and volumes, then bootstraps the stack again.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1"
    exit 1
  fi
}

need_cmd docker
need_cmd bash

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: environment file not found: $ENV_FILE"
  echo "Create it first or run: DOMAIN=your-domain bash scripts/deploy-prod.sh"
  exit 1
fi

echo "This will fully rebuild the production stack for project: ${PROJECT_NAME}"
echo
echo "The following project data will be deleted:"
echo "  - config-db volume"
echo "  - flowable-db volume"
echo "  - grafana volume"
echo "  - running containers from this compose project"
echo
echo "Files kept:"
echo "  - $ENV_FILE"
echo "  - infra/nginx/certs"
echo "  - backups/"
echo
read -r -p "Continue with full rebuild? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

cd "$ROOT_DIR"

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" down -v --remove-orphans || true

bash "$ROOT_DIR/scripts/deploy-prod.sh"

echo
echo "Full rebuild completed."
