# Credit Platform v5: C4-style архитектура

## Назначение

Этот документ описывает архитектуру платформы в формате `C4`:

- `C1` System Context
- `C2` Container
- `C3` Component
- `C4` Dynamic / Runtime view

Документ полезен для:

- техлидов
- backend / frontend engineers
- DevOps
- архитектурного review

## C1. System Context

### Цель уровня

Показать систему как единый продукт в окружении пользователей и внешних систем.

```mermaid
flowchart TB
    classDef user fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef system fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;

    Mobile["Мобильное приложение"]:::user
    Ops["Операторы / аналитики"]:::user
    Platform["Credit Platform v5"]:::system
    Bureaus["Внешние источники данных<br/>isoftpull / creditsafe / plaid / crm"]:::ext
    Snp["SNP"]:::ext
    FlowableActor["Flowable modelers / BPMN operators"]:::user

    Mobile --> Platform
    Ops --> Platform
    FlowableActor --> Platform
    Platform --> Bureaus
    Platform --> Snp
```

### Смысл

Система выступает как единая orchestration-платформа между:

- внешними клиентами и операторами
- внутренними правилами принятия решений
- внешними сервисами и downstream-системами

## C2. Container View

### Цель уровня

Показать основные runtime-контейнеры, их ответственность и связи.

```mermaid
flowchart LR
    classDef edge fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef app fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef proc fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;
    classDef obs fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:2px;

    Internet["Internet / users"]:::edge
    Nginx["nginx<br/>TLS, reverse proxy"]:::edge
    Admin["admin-ui<br/>React"]:::app
    Core["core-api<br/>FastAPI"]:::app
    Orch["orchestrators<br/>custom + flowable adapters"]:::proc
    Proc["processors<br/>parser + stop-factor"]:::proc
    FlowRest["flowable-rest"]:::proc
    FlowUi["flowable-ui"]:::proc
    ConfigDb["config-db"]:::data
    FlowDb["flowable-db"]:::data
    Connectors["connectors<br/>isoftpull / creditsafe / plaid / crm"]:::ext
    Obs["prometheus / grafana"]:::obs

    Internet --> Nginx
    Nginx --> Admin
    Nginx --> Core
    Nginx --> FlowUi
    Nginx --> Obs
    Admin --> Core
    Core --> ConfigDb
    Core --> Orch
    Core --> Proc
    Orch --> FlowRest
    Orch --> Connectors
    Proc --> ConfigDb
    FlowRest --> FlowDb
    FlowUi --> FlowDb
    Core --> Obs
```

### Контейнеры

| Container | Технология | Ответственность |
| --- | --- | --- |
| `nginx` | nginx | TLS, public routing, reverse proxy |
| `admin-ui` | React / Vite | операторский UI |
| `core-api` | FastAPI | заявки, конфиг, routing, audit, auth |
| `orchestrators` | FastAPI services | custom и flowable execution adapters |
| `processors` | FastAPI services | report parser и stop-factor processor |
| `flowable-rest` | Flowable | BPMN runtime engine |
| `flowable-ui` | Flowable UI | modeler / admin / IDM |
| `config-db` | PostgreSQL | бизнес-конфиг и runtime data платформы |
| `flowable-db` | PostgreSQL | engine state и BPMN source of truth |
| `connectors` | FastAPI mocks / integrations | внешние данные и бюро |
| `prometheus/grafana` | OSS stack | наблюдаемость |

## C3. Component View: `core-api`

### Цель уровня

Показать внутренние доменные компоненты главного API.

```mermaid
flowchart TB
    classDef api fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef proc fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;

    Api["core-api"]:::api

    Auth["Auth / role resolution"]:::api
    Requests["Request lifecycle API"]:::api
    Routing["Routing engine"]:::api
    Stops["Stop-factor orchestration"]:::api
    Services["Service registry / config"]:::api
    Tracker["Process tracker"]:::api
    Audit["Audit log"]:::api
    FlowOps["Flowable facade / ops API"]:::api
    Finalize["Finalize + SNP notification"]:::proc
    ConfigDb["config-db"]:::data

    Api --> Auth
    Api --> Requests
    Api --> Routing
    Api --> Stops
    Api --> Services
    Api --> Tracker
    Api --> Audit
    Api --> FlowOps
    Requests --> Finalize
    Auth --> ConfigDb
    Requests --> ConfigDb
    Routing --> ConfigDb
    Stops --> ConfigDb
    Services --> ConfigDb
    Tracker --> ConfigDb
    Audit --> ConfigDb
    Finalize --> ConfigDb
```

### Компоненты `core-api`

| Компонент | Ответственность |
| --- | --- |
| `Auth` | UI login, session tokens, role resolution |
| `Requests API` | create/list/detail requests |
| `Routing engine` | `auto -> custom/flowable`, canary, daily quota |
| `Stop-factor orchestration` | pre/post business checks |
| `Service registry` | source of runtime endpoints |
| `Process tracker` | runtime trace for each request |
| `Audit log` | config and operator action history |
| `Flowable facade` | safe UI access to Flowable runtime |
| `Finalize + SNP` | final status, post-stop-factor, outbound SNP |

## C3. Component View: `orchestrators`

### Цель уровня

Показать, как устроен runtime execution layer.

```mermaid
flowchart LR
    classDef proc fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;

    Config["Config API"]:::data
    Custom["custom-adapter"]:::proc
    Flowable["flowable-adapter"]:::proc
    Parser["report-parser"]:::proc
    Stop["stop-factor"]:::proc
    Connectors["connectors"]:::ext
    FlowRest["flowable-rest"]:::proc

    Custom --> Config
    Flowable --> Config
    Custom --> Connectors
    Custom --> Parser
    Flowable --> FlowRest
    Flowable --> Connectors
    Flowable --> Parser
    Custom --> Stop
    Flowable --> Stop
```

### Компоненты execution layer

| Компонент | Ответственность |
| --- | --- |
| `custom-adapter` | sequential / configured execution of connector chain |
| `flowable-adapter` | start BPMN instance and normalize result back to platform |
| `report-parser` | produce `parsed_report` from raw step data |
| `stop-factor processor` | evaluate business rules |

## C4. Dynamic View: основной happy-path

### Цель уровня

Показать основную динамику обработки заявки.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client
    participant Core as core-api
    participant Db as config-db
    participant Stop as stop-factor
    participant Orch as adapter
    participant Flow as flowable-rest
    participant Conn as connectors
    participant SNP as SNP

    Client->>Core: POST /api/v1/requests
    Core->>Db: save submitted request
    Core->>Stop: PRE checks
    Stop-->>Core: PASS
    Core->>Core: resolve_mode()

    alt custom
        Core->>Orch: call custom-adapter
        Orch->>Conn: execute enabled connectors
        Conn-->>Orch: step payloads
        Orch-->>Core: normalized result
    else flowable
        Core->>Orch: call flowable-adapter
        Orch->>Flow: start process instance
        Flow->>Conn: service tasks
        Conn-->>Flow: responses
        Flow-->>Orch: completion
        Orch-->>Core: normalized result
    end

    Core->>Stop: POST checks
    Stop-->>Core: PASS / REVIEW / REJECT
    Core->>Db: persist final status + tracker + audit
    Core->>SNP: send final envelope
```

## C4. Dynamic View: canary routing

### Цель уровня

Показать, как работает canary с quota.

```mermaid
flowchart TD
    Start["Applicant Input v2 received"] --> Normalize["Normalize input and set internal orchestration_mode=auto"]
    Normalize --> Match["Match enabled routing rules by priority"]
    Match --> Canary["Canary rule matched?"]
    Canary -->|No| Next["Check next rule"]
    Canary -->|Yes| Percent["Bucket in sample_percent?"]
    Percent -->|No| Next
    Percent -->|Yes| Quota["Daily quota reached?"]
    Quota -->|Yes| Next
    Quota -->|No| Flowable["Route to flowable"]
    Next --> Custom["Fallback custom rule"]
```

## Deployment view

### Dev / local

- host ports открыты наружу
- удобно для локальной разработки и ручного тестирования

### Production

- публично exposed только `80/443`
- `nginx` публикует:
  - `admin-ui`
  - `core-api`
  - `flowable-ui`
  - `grafana`
- internal runtime остается внутри docker networks

## Архитектурные решения

### 1. UI не ходит в Flowable REST напрямую

Решение:

- `admin-ui -> core-api -> flowable-rest`

Причина:

- секреты остаются на сервере
- есть whitelist действий
- есть единый audit
- UI получает нормализованный ответ

### 2. BPMN source of truth может быть в Flowable

Если:

```text
FLOWABLE_AUTO_DEPLOY_BPMN=false
```

то production-источник истины для BPMN находится в `flowable-db`.

### 3. Routing отделён от execution

`core-api` выбирает путь, а adapters исполняют маршрут.

Это позволяет:

- безопасно переключать сценарии
- делать canary rollout
- не связывать всю платформу с одним execution engine

## Риски и ограничения

### Текущие ограничения

- fallback при отсутствии matching rules = `flowable`
- `daily quota` считается по UTC
- SNP сейчас best-effort без встроенного retry queue
- async completion Flowable по-прежнему adapter-driven, а не через отдельный durable worker

### Основные точки внимания

- порядок и `priority` routing rules
- согласованность service registry и orchestration runtime
- версионирование BPMN при редактировании через Flowable UI

## Когда использовать этот документ

Использовать `ARCHITECTURE_C4_RU.md`, когда нужен:

- архитектурный review
- onboarding инженеров
- техдизайн обсуждение
- подготовка к Confluence / ADR / design review
