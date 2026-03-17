# Production Deployment

This project supports a production deployment using:

- `docker-compose.yml`
- `docker-compose.prod.yml`
- `infra/nginx/nginx.conf`

## Prerequisites

- Ubuntu 22.04+ or another Linux host with Docker Engine
- Docker Compose plugin
- DNS record pointing your domain to the server
- TLS certificate files for the domain

## 1. Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
```

## 2. Generate production environment

```bash
bash scripts/generate-env.sh .env.prod
```

Review `.env.prod` and update at least:

- `DOMAIN`
- `CORS_ORIGINS`
- any integration URLs such as `SNP_EXTERNAL_URL`

You can also start from `.env.prod.example` if you prefer to fill values manually.

## 3. One-command bootstrap

If you want the stack to prepare itself and come up in one command, run:

```bash
DOMAIN=admin.example.com bash scripts/deploy-prod.sh
```

What it does:

- creates `.env.prod` if it does not exist
- updates `DOMAIN` and `CORS_ORIGINS`
- generates a self-signed TLS certificate if real certs are still missing
- validates the Compose configuration
- starts the production stack

This is the fastest path to a working deployment. After first boot, replace the self-signed certificate with a real one.

## 4. Install TLS certificate files

Place certificate files here:

```text
infra/nginx/certs/fullchain.pem
infra/nginx/certs/privkey.pem
```

If these files are missing, nginx will fail to start.

## 5. Start the production stack manually

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --build
```

## 6. Verify services

```bash
docker compose ps
docker compose logs -f nginx
docker compose logs -f core-api
curl -k https://YOUR_DOMAIN/health
```

Expected result:

- `nginx` is up
- `core-api` is healthy
- `https://YOUR_DOMAIN/health` returns JSON from the API

## 7. Public endpoints

- Admin UI: `https://YOUR_DOMAIN/`
- API: `https://YOUR_DOMAIN/api/`
- Flowable Modeler: `https://YOUR_DOMAIN/flowable-modeler/`
- Flowable Admin: `https://YOUR_DOMAIN/flowable-admin/`
- Flowable IDM: `https://YOUR_DOMAIN/flowable-idm/`
- Flowable Task: `https://YOUR_DOMAIN/flowable-task/`
- Compatibility path: `https://YOUR_DOMAIN/flowable-ui/` -> redirects to `/flowable-modeler/`
- Grafana: `https://YOUR_DOMAIN/grafana/`

Internal services are not exposed in the production override.

## Notes

- The production override uses Compose merge tags such as `!reset`. If your Compose version cannot parse them, upgrade the Docker Compose plugin.
- `flowable-ui` is enabled in production and proxied through nginx behind explicit per-app routes (`/flowable-modeler/`, `/flowable-admin/`, `/flowable-idm/`, `/flowable-task/`).
- `FLOWABLE_AUTO_DEPLOY_BPMN=false` means Flowable UI and the Flowable database become the source of truth for BPMN definitions.
- If you edit and deploy a model from Flowable UI, keep the same process definition key expected by the adapter unless you intentionally update it in configuration.
- `admin-ui` uses the production image defined in `admin-ui/Dockerfile.prod`.
- Use the same `FLOWABLE_DB_PASSWORD` value consistently in both local/base and production Compose runs. If Flowable was first started with a different DB password, recreate only the Flowable stack with:

```bash
bash scripts/reset-flowable.sh
```

That command removes only Flowable DB data and brings back `flowable-db`, `flowable-rest`, `flowable-ui`, and `nginx`.
