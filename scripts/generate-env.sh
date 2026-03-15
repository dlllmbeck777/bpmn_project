#!/bin/bash
# Generate a production .env file with random secrets.
# Usage:
#   bash scripts/generate-env.sh [output_file]

set -euo pipefail

OUTPUT="${1:-.env.prod}"

if [ -f "$OUTPUT" ]; then
  echo "ERROR: $OUTPUT already exists. Remove it first or use another path."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate secrets."
  exit 1
fi

cat > "$OUTPUT" <<EOF
# Credit Platform v5 production environment
# Generated on $(date -Iseconds)

DOMAIN=admin.yourdomain.com

CONFIG_DB_NAME=config
CONFIG_DB_USER=config
CONFIG_DB_PASSWORD=$(openssl rand -base64 24)

FLOWABLE_DB_PASSWORD=$(openssl rand -base64 24)

ENCRYPT_KEY=$(openssl rand -hex 32)

GATEWAY_API_KEY=$(openssl rand -hex 32)
ADMIN_API_KEY=$(openssl rand -hex 32)
SENIOR_ANALYST_API_KEY=$(openssl rand -hex 32)
ANALYST_API_KEY=$(openssl rand -hex 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)

FLOWABLE_PASSWORD=$(openssl rand -base64 18)
FLOWABLE_AUTO_DEPLOY_BPMN=false
GRAFANA_PASSWORD=$(openssl rand -base64 18)

ADMIN_LOGIN_USERNAME=admin
ADMIN_LOGIN_PASSWORD=$(openssl rand -base64 18)
SENIOR_ANALYST_LOGIN_USERNAME=senior
SENIOR_ANALYST_LOGIN_PASSWORD=$(openssl rand -base64 18)
ANALYST_LOGIN_USERNAME=analyst
ANALYST_LOGIN_PASSWORD=$(openssl rand -base64 18)

SESSION_TTL_HOURS=8
DB_POOL_MIN=4
DB_POOL_MAX=20
LOG_LEVEL=INFO
RATE_LIMIT_PER_MIN=60

CORS_ORIGINS=https://admin.yourdomain.com

SNP_EXTERNAL_URL=
EOF

echo
echo "Generated: $OUTPUT"
echo
echo "Review before deploying:"
echo "  1. Set DOMAIN to your real hostname"
echo "  2. Set CORS_ORIGINS to the public admin URL"
echo "  3. Place TLS certs in infra/nginx/certs/fullchain.pem and privkey.pem"
echo
echo "Admin login password:"
grep '^ADMIN_LOGIN_PASSWORD=' "$OUTPUT"
echo
echo "Start production with:"
echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file $OUTPUT up -d --build"
