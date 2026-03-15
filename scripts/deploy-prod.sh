#!/bin/bash
# One-command production bootstrap.
# Example:
#   DOMAIN=admin.example.com bash scripts/deploy-prod.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
CERT_DIR="$ROOT_DIR/infra/nginx/certs"
FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"
PLACEHOLDER_DOMAIN="admin.yourdomain.com"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1"
    exit 1
  fi
}

get_env_value() {
  local key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2-
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

generate_self_signed_cert() {
  local domain="$1"
  local san
  if [[ "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    san="IP:${domain}"
  else
    san="DNS:${domain}"
  fi

  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$PRIVKEY" \
    -out "$FULLCHAIN" \
    -subj "/CN=${domain}" \
    -addext "subjectAltName=${san}" >/dev/null 2>&1
}

need_cmd docker
need_cmd openssl

if [ ! -f "$ENV_FILE" ]; then
  bash "$ROOT_DIR/scripts/generate-env.sh" "$ENV_FILE"
fi

DOMAIN_VALUE="${DOMAIN:-$(get_env_value DOMAIN)}"
if [ -z "$DOMAIN_VALUE" ] || [ "$DOMAIN_VALUE" = "$PLACEHOLDER_DOMAIN" ]; then
  echo "ERROR: DOMAIN is not set."
  echo "Run like this:"
  echo "  DOMAIN=admin.example.com bash scripts/deploy-prod.sh"
  echo "Or edit $ENV_FILE and set DOMAIN manually."
  exit 1
fi

set_env_value DOMAIN "$DOMAIN_VALUE"

CURRENT_CORS="$(get_env_value CORS_ORIGINS)"
if [ -z "$CURRENT_CORS" ] || [ "$CURRENT_CORS" = "https://${PLACEHOLDER_DOMAIN}" ]; then
  set_env_value CORS_ORIGINS "https://${DOMAIN_VALUE}"
fi

mkdir -p "$CERT_DIR" "$ROOT_DIR/backups"

if [ ! -f "$FULLCHAIN" ] || [ ! -f "$PRIVKEY" ]; then
  echo "TLS certificates not found. Generating a self-signed certificate for ${DOMAIN_VALUE}."
  echo "Replace it later with a real certificate for production use."
  generate_self_signed_cert "$DOMAIN_VALUE"
fi

cd "$ROOT_DIR"

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" config >/dev/null
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo
echo "Production stack started."
echo "Environment file: $ENV_FILE"
echo "URL: https://${DOMAIN_VALUE}/"
echo
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" ps
