# Credit Platform v5

Multi-service credit orchestration platform built with FastAPI, PostgreSQL, Flowable, React/Vite, Prometheus and Grafana.

## Quick Start

```bash
cp .env.example .env
# Edit .env and set ENCRYPT_KEY plus any optional API keys/passwords
docker compose up -d --build
```

## Services (14)

| Service | Port | Purpose |
| --- | --- | --- |
| `config-db` | 5433 | PostgreSQL for config and requests |
| `core-api` | 8000 | Gateway, config API, request lifecycle |
| `processors` | 8105, 8106 | Report parser and stop-factor processor |
| `orchestrators` | 8011, 8012 | Flowable adapter and custom adapter |
| `isoftpull` | 8101 | Mock bureau connector |
| `creditsafe` | 8102 | Mock company score connector |
| `plaid` | 8103 | Mock accounts connector |
| `crm` | 8104 | Mock CRM connector |
| `flowable-db` | 5434 | PostgreSQL for Flowable |
| `flowable-rest` | 8085 | Flowable REST engine |
| `flowable-ui` | 8080 | Flowable UI |
| `admin-ui` | 3000 | React admin console |
| `prometheus` | 9090 | Metrics collection |
| `grafana` | 3001 | Dashboards |

## Key Features

- Field-level encryption for sensitive identifiers with legacy decrypt support.
- Optional `GATEWAY_API_KEY`, `ADMIN_API_KEY`, and `INTERNAL_API_KEY`.
- Request persistence, audit log, stop factors, routing rules, and configurable pipeline steps.
- Shared config invalidation, shared rate limiting, and shared circuit breaker state in PostgreSQL.
- Flowable orchestration with BPMN auto-deploy and callback-based completion.
- Prometheus metrics and Grafana datasource provisioning.

## Default Flow

1. Client submits `/api/v1/requests`.
2. `core-api` authenticates, rate-limits, encrypts `iin`, and runs PRE stop factors.
3. Request is routed to `flowable-adapter` or `custom-adapter`.
4. Connectors run, parser builds `parsed_report`, and POST stop factors are evaluated.
5. `core-api` stores the final state and forwards SNP notification if configured.

## Notes

- `admin-ui` uses `localStorage` for API base URL and `X-Api-Key`.
- Default seeded stop factors target `result.parsed_report.summary.*`.
- The Flowable path uses callback completion via `/internal/cases/complete`.
