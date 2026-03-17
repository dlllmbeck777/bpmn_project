# Credit Platform v5

Multi-service credit orchestration platform built with FastAPI, PostgreSQL, Flowable, React/Vite, Prometheus, and Grafana.

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build
```

The local stack exposes the main services directly on host ports and is intended for development and testing.

## Production Deployment

This repository also includes production deployment assets:

- `docker-compose.prod.yml`
- `infra/nginx/nginx.conf`
- `admin-ui/Dockerfile.prod`
- `scripts/generate-env.sh`
- `docs/DEPLOYMENT.md`
- `docs/OPERATIONS_RUNBOOK_RU.md`
- `docs/TECH_SPECIFICATION_RU.md`
- `docs/CONFLUENCE_READY_RU.md`

Typical production flow:

```bash
DOMAIN=admin.example.com bash scripts/deploy-prod.sh
```

See `docs/DEPLOYMENT.md` for the full walkthrough.

Russian operational and project documentation:

- `docs/OPERATIONS_RUNBOOK_RU.md`
- `docs/TECH_SPECIFICATION_RU.md`
- `docs/CONFLUENCE_READY_RU.md`
- `docs/ARCHITECTURE_EXECUTIVE_RU.md`
- `docs/ARCHITECTURE_TECHNICAL_RU.md`
- `docs/ARCHITECTURE_C4_RU.md`
- `docs/CONFLUENCE_PASTE_READY_NO_MERMAID_RU.md`
- `docs/INTEGRATION_SPEC_IT_RU.md`
- `docs/INTEGRATION_SPEC_MOBILE_RU.md`
- `docs/INTEGRATION_SPEC_SNP_RU.md`
- `docs/API_CHEATSHEET_RU.md`
- `docs/FLOWABLE_STABILIZATION_RU.md`
- `docs/MOCK_BUREAUS_SERVICE_RU.md`
- `docs/TEST_SPEC_MOCK_CONNECTORS_RU.md`
- `docs/DEMO_TEST_CASES_RU.md`

## Stress Test

For request submission load testing, use `k6` with `scripts/stress-test-requests.js`.
Detailed steps are in `docs/STRESS_TEST.md`.

For production Flowable access, use the direct app routes behind nginx:
- UI: `https://YOUR_DOMAIN/flowable-ui/`
- task: `https://YOUR_DOMAIN/flowable-task/`
- modeler: `https://YOUR_DOMAIN/flowable-modeler/`
- admin: `https://YOUR_DOMAIN/flowable-admin/`
- IDM/login: `https://YOUR_DOMAIN/flowable-idm/`

Each route is proxied directly to its Flowable app. `FLOWABLE_AUTO_DEPLOY_BPMN=false` is recommended so BPMN definitions edited in Flowable UI are not overwritten by file-based auto-deploy on restart.

## Services (15, including optional mock)

| Service | Port | Purpose |
| --- | --- | --- |
| `config-db` | 5433 | PostgreSQL for config and requests |
| `core-api` | 8000 | Gateway, config API, request lifecycle |
| `processors` | 8105, 8106, 8107 | Report parser, stop-factor processor, and decision service |
| `orchestrators` | 8011, 8012 | Flowable adapter and custom adapter |
| `isoftpull` | 8101 | Mock bureau connector |
| `creditsafe` | 8102 | Mock company score connector |
| `plaid` | 8103 | Mock accounts connector |
| `mock-bureaus` | 8110 | Built-in unified mock applicant backend for iSoftPull, Creditsafe, and Plaid |
| `flowable-db` | 5434 | PostgreSQL for Flowable |
| `flowable-rest` | 8085 | Flowable REST engine |
| `flowable-ui` | 8080 | Flowable UI |
| `admin-ui` | 3000 | React admin console |
| `prometheus` | 9090 | Metrics collection |
| `grafana` | 3001 | Dashboards |

## Key Features

- Protection of sensitive applicant data and operational masking in UI/logging flows.
- Role-scoped API keys and UI logins for admin, senior analyst, and analyst flows.
- Request persistence, audit log, stop factors, routing rules, and configurable pipeline steps.
- Shared config invalidation, shared rate limiting, and shared circuit breaker state in PostgreSQL.
- Flowable orchestration with BPMN auto-deploy and callback-based completion.
- Prometheus metrics and Grafana datasource provisioning.

## Default Flow

1. Client submits `/api/v1/requests` with applicant profile fields.
2. `core-api` authenticates, validates input, generates internal `request_id`, and runs PRE stop factors.
3. Request is routed internally to `flowable-adapter` or `custom-adapter`.
4. Connectors run, parser builds `parsed_report`, and POST stop factors are evaluated.
5. `core-api` stores the final state and forwards SNP notification if configured.

## Notes

- `admin-ui` stores API base URL and session data in `localStorage`.
- The external input contract is documented as `Applicant Input v2` in `docs/INTEGRATION_SPEC_IT_RU.md`.
- For leadership demos and connector QA without paid external calls, use the built-in `mock-bureaus` service and switch `credit-backend` from `Services` with `Use unified mock backend`.
- Locally `mock-bureaus` is available on `http://localhost:8110`; in production use `https://<host>/mock-bureaus` through nginx.
- The fast switch between demo and real upstream is now a one-line change in service registry: `credit-backend.base_url`.
- The Flowable path uses callback completion via `/internal/cases/complete`.
- For production, use the dedicated UI image in `admin-ui/Dockerfile.prod`.
