# Credit Platform v5: Техническая архитектура для команды и разработчиков

## Назначение

Этот документ описывает архитектуру платформы на техническом уровне:

- контейнеры и домены
- сетевую схему
- request lifecycle
- ownership данных
- configuration flow
- production topology

Документ предназначен для:

- backend engineers
- frontend engineers
- DevOps
- senior analysts
- технических лидов

## 1. Контекстная схема

```mermaid
flowchart TB
    classDef user fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef app fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef proc fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;
    classDef db fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef obs fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:2px;

    Users["Operators / Analysts / API clients"]:::user
    Nginx["nginx<br/>TLS / reverse proxy"]:::app
    Admin["admin-ui<br/>React / Vite"]:::app
    Core["core-api<br/>FastAPI"]:::app
    Orch["orchestrators<br/>flowable-adapter + custom-adapter"]:::proc
    Proc["processors<br/>report parser + stop-factor"]:::proc
    Conn["connectors<br/>isoftpull / creditsafe / plaid / crm"]:::ext
    FlowableRest["flowable-rest"]:::proc
    FlowableUi["flowable-ui"]:::proc
    ConfigDb["config-db"]:::db
    FlowableDb["flowable-db"]:::db
    Obs["prometheus / grafana"]:::obs

    Users --> Nginx
    Nginx --> Admin
    Nginx --> Core
    Nginx --> FlowableUi
    Admin --> Core
    Core --> ConfigDb
    Core --> Orch
    Core --> Proc
    Orch --> Conn
    Orch --> FlowableRest
    Proc --> ConfigDb
    FlowableRest --> FlowableDb
    FlowableUi --> FlowableDb
    Core --> Obs
```

## 2. Контейнерная архитектура

```mermaid
flowchart LR
    classDef frontend fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef backend fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef flow fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef db fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;
    classDef obs fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:2px;

    subgraph Frontend["Frontend / Edge"]
        Nginx["nginx"]:::frontend
        Admin["admin-ui"]:::frontend
    end

    subgraph Backend["Core domain"]
        Core["core-api"]:::backend
        Orch["orchestrators"]:::backend
        Proc["processors"]:::backend
        ConfigDb["config-db"]:::db
    end

    subgraph Flowable["BPMN domain"]
        FlowableRest["flowable-rest"]:::flow
        FlowableUi["flowable-ui"]:::flow
        FlowableDb["flowable-db"]:::db
    end

    subgraph Integrations["Connectors"]
        Isoft["isoftpull"]:::ext
        Creditsafe["creditsafe"]:::ext
        Plaid["plaid"]:::ext
        Crm["crm"]:::ext
    end

    subgraph Observability["Observability"]
        Prom["prometheus"]:::obs
        Graf["grafana"]:::obs
    end

    Nginx --> Admin
    Nginx --> Core
    Nginx --> FlowableUi
    Nginx --> Graf

    Admin --> Core
    Core --> ConfigDb
    Core --> Orch
    Core --> Proc
    Core --> Prom

    Orch --> Isoft
    Orch --> Creditsafe
    Orch --> Plaid
    Orch --> Crm
    Orch --> FlowableRest

    Proc --> ConfigDb

    FlowableRest --> FlowableDb
    FlowableUi --> FlowableDb
    Prom --> Graf
```

## 3. Сетевые домены

По compose-конфигурации используются сети:

- `frontend`
  edge и UI-доступ
- `backend`
  `core-api`, orchestrators, processors, connectors
- `db`
  `config-db`
- `flowable`
  `flowable-rest`, `flowable-ui`, `flowable-db`, `orchestrators`, `nginx`
- `monitoring`
  `prometheus`, `grafana`

### Практический смысл

- `nginx` имеет доступ к `frontend` и `flowable`
- `core-api` не должен ходить напрямую в `flowable-ui`
- `orchestrators` связывают `backend` и `flowable`
- `config-db` и `flowable-db` разделены намеренно

## 4. Ownership данных

| Домен данных | Источник истины | Где используется |
| --- | --- | --- |
| Заявки | `config-db` | `core-api`, UI, tracker |
| Routing rules | `config-db` | `core-api`, UI |
| Pipeline steps | `config-db` | `core-api`, UI, orchestrators |
| Stop factors | `config-db` | `core-api`, processors, UI |
| Services registry | `config-db` | `core-api`, orchestrators, UI |
| Admin users / sessions | `config-db` | `core-api`, UI |
| Audit log | `config-db` | `core-api`, UI |
| Request tracker events | `config-db` | `core-api`, UI |
| BPMN models | `flowable-db` при `FLOWABLE_AUTO_DEPLOY_BPMN=false` | Flowable UI / engine |
| Runtime process state | `flowable-db` | Flowable engine |

## 5. Жизненный цикл заявки

```mermaid
sequenceDiagram
    autonumber
    participant Client as API Client
    participant Nginx as nginx
    participant Core as core-api
    participant Config as config-db
    participant Proc as processors
    participant Orch as orchestrators
    participant Flow as flowable-rest
    participant Conn as connectors

    Client->>Nginx: POST /api/v1/requests
    Nginx->>Core: proxied request
    Core->>Core: auth + rate limit + validation
    Core->>Config: persist request
    Core->>Proc: PRE stop-factor check
    Proc-->>Core: PASS / REVIEW / REJECT

    alt request blocked by PRE stop factors
        Core->>Config: finalize request
    else request allowed
        Core->>Core: resolve_mode()
        alt selected_mode = custom
            Core->>Orch: call custom-adapter
            Orch->>Conn: call enabled connectors
            Conn-->>Orch: raw reports
            Orch-->>Core: aggregated result
        else selected_mode = flowable
            Core->>Orch: call flowable-adapter
            Orch->>Flow: start BPMN instance
            Flow->>Conn: service tasks / connector calls
            Conn-->>Flow: raw reports
            Flow-->>Orch: completion path
            Orch-->>Core: normalized result
        end

        Core->>Proc: POST stop-factor check
        Proc-->>Core: PASS / REVIEW / REJECT
        Core->>Config: finalize request + tracker + audit
    end
```

## 6. Routing engine

Routing logic находится в `core-api/coreapi/services.py`.

### Алгоритм

Перед routing внешняя заявка нормализуется во внутреннюю модель. Для внешнего контракта `Applicant Input v2` поле `orchestration_mode` клиентом не передается, и платформа выставляет внутреннее значение `auto`.

1. Если во внутренней модели `orchestration_mode` уже не `auto`, вернуть заданный режим
2. Итерировать `enabled` rules по `priority`
3. Проверить:
   - condition match
   - canary match
   - daily quota match
4. Вернуть первый `target_mode`
5. Если ничего не подошло, fallback = `flowable`

### Поля routing rule

- `name`
- `priority`
- `condition_field`
- `condition_op`
- `condition_value`
- `target_mode`
- `enabled`
- `meta`

### `meta` для canary

- `sample_percent`
  доля трафика, идущая в rule
- `sticky_field`
  поле для детерминированного bucket selection
- `daily_quota_enabled`
  включает дневной лимит
- `daily_quota_max`
  максимум заявок в день для данного rule

### Важно

`daily_quota` сейчас считается по UTC-суткам.

## 7. UI control plane

### `Scenarios`

Страница `Scenarios` является операторским UI-слоем поверх:

- `routing_rules`
- `pipeline_steps`
- `stop_factors`
- `services`

Она не вводит новую бизнес-сущность, а управляет уже существующими конфигурациями согласованным способом.

### Что можно делать через `Scenarios`

- перевести весь auto-трафик в `custom`
- подготовить custom reports chain
- настроить Flowable canary
- отключить все stop factors

### Flowable canary block

Содержит:

- `Percent`
- `Sticky field`
- `Enabled`
- `Daily quota mode`
- `Max requests per day`
- `Apply`

## 8. Pipeline behavior

Pipeline steps хранятся в БД и читаются orchestrator-ами через config API.

Поддерживаются:

- `enabled`
- `skip_in_custom`
- `skip_in_flowable`

### Runtime semantics

- если step выключен для текущего режима, он логируется как `SKIPPED`
- если service отключен в registry, orchestrator не вызывает его и пишет `SKIPPED`

## 9. Services registry

Services registry определяет runtime endpoint-ы для:

- connectors
- engine
- adapters
- processors

Основные поля:

- `id`
- `type`
- `base_url`
- `endpoint_path`
- `timeout_ms`
- `retry_count`
- `enabled`

## 10. Flowable integration model

### Best practice

UI не ходит в Flowable REST напрямую.

Схема:

```text
Admin UI -> core-api -> Flowable REST
```

### Почему

- креды Flowable остаются на сервере
- есть whitelist доступных действий
- есть audit
- UI работает с нормализованной моделью

### Production modeling mode

Если `FLOWABLE_AUTO_DEPLOY_BPMN=false`:

- Flowable UI и Flowable DB становятся source of truth для BPMN
- изменения модели сохраняются внутри Flowable
- file-based auto-deploy не должен перезаписывать production model

## 11. Request tracking and audit

### Request tracker

Хранит:

- входы и выходы по шагам
- статусы сервисов
- payload snippets
- состояние заявки

### Audit log

Хранит:

- entity
- action
- actor context
- payload change
- timestamp

### Разделение

- tracker = business/runtime trace
- audit = configuration and operator actions

## 12. Production topology

```mermaid
flowchart TB
    classDef edge fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef app fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef flow fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef db fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef obs fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:2px;

    Internet["Internet / Users"]:::edge
    Nginx["nginx<br/>80/443"]:::edge

    subgraph Public["Published through nginx"]
        Admin["admin-ui"]:::app
        Core["core-api"]:::app
        FlowUi["flowable-ui"]:::flow
        Graf["grafana"]:::obs
    end

    subgraph Private["Internal-only runtime"]
        Orch["orchestrators"]:::app
        Proc["processors"]:::app
        Conn["connectors"]:::app
        FlowRest["flowable-rest"]:::flow
        ConfigDb["config-db"]:::db
        FlowDb["flowable-db"]:::db
        Prom["prometheus"]:::obs
    end

    Internet --> Nginx
    Nginx --> Admin
    Nginx --> Core
    Nginx --> FlowUi
    Nginx --> Graf

    Core --> Orch
    Core --> Proc
    Core --> ConfigDb
    Orch --> Conn
    Orch --> FlowRest
    FlowRest --> FlowDb
    FlowUi --> FlowDb
    Core --> Prom
    Prom --> Graf
```

## 13. Deployment and operations

### One-command bootstrap

```bash
DOMAIN=your-domain.com bash scripts/deploy-prod.sh
```

### Reset only Flowable

```bash
bash scripts/reset-flowable.sh
```

### Full production rebuild

```bash
bash scripts/rebuild-prod.sh
```

## 14. Main operational failure modes

### 1. Requests go to wrong mode

Проверять:

- `routing_rules`
- priorities
- enabled flags
- canary percent
- daily quota state
- orchestrator config cache

### 2. Flowable UI unavailable

Проверять:

- `flowable-db`
- `flowable-rest`
- `flowable-ui`
- `nginx`
- `FLOWABLE_DB_PASSWORD`

### 3. UI shows stale behavior

Проверять:

- актуальный frontend bundle
- hard refresh / incognito
- actual `core-api` build on server

### 4. Service disabled but still called

Проверять:

- registry `enabled`
- orchestrator build version
- config cache refresh window

## 15. Recommended future improvements

- business timezone-aware daily quota
- draft/publish for routing and pipeline configs
- explicit rollback snapshots for scenarios
- OpenTelemetry propagation across core-api, adapters, processors, connectors
- durable worker instead of in-process async watcher for Flowable completion
