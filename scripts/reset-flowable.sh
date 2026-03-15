#!/bin/bash
# Recreates only the Flowable database/UI/runtime part of the stack.
# This removes Flowable DB data, including deployed models and runtime history.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"

COMPOSE_ARGS=(-f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1"
    exit 1
  fi
}

need_cmd docker

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: environment file not found: $ENV_FILE"
  exit 1
fi

echo "About to remove Flowable DB data and recreate:"
echo "  - flowable-db"
echo "  - flowable-rest"
echo "  - flowable-ui"
echo "  - nginx"
echo
echo "Models deployed in Flowable UI and Flowable runtime history will be lost."
read -r -p "Continue? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

cd "$ROOT_DIR"

docker compose "${COMPOSE_ARGS[@]}" stop nginx flowable-ui flowable-rest flowable-db || true
docker compose "${COMPOSE_ARGS[@]}" rm -f nginx flowable-ui flowable-rest flowable-db || true

VOLUME_NAME="$(docker volume ls \
  --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
  --filter "label=com.docker.compose.volume=flowable_db_data" \
  --format '{{.Name}}' | head -n1)"

if [ -z "$VOLUME_NAME" ]; then
  VOLUME_NAME="${PROJECT_NAME}_flowable_db_data"
fi

if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  docker volume rm -f "$VOLUME_NAME"
fi

docker compose "${COMPOSE_ARGS[@]}" up -d --build flowable-db flowable-rest flowable-ui nginx

echo
echo "Flowable stack recreated."
docker compose "${COMPOSE_ARGS[@]}" ps flowable-db flowable-rest flowable-ui nginx
