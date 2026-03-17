# Credit Platform v5: Confluence paste-ready без Mermaid

## Назначение

Этот документ предназначен для случаев, когда:

- Mermaid не рендерится в Confluence
- нужно быстро вставить архитектуру в wiki
- нужно получить читаемый текст без diagram plugins

Ниже даны:

- текстовые блок-схемы
- таблицы
- готовые описания уровней архитектуры

---

## 1. Executive architecture

### Текстовая блок-схема

```text
Клиенты / операторы
        |
        v
    Admin UI
        |
        v
     Core API
        |
        +--------------------> Config DB
        |
        +--------------------> Routing / Stop factors / Pipeline
        |
        +--------------------> Custom orchestration
        |                           |
        |                           +--> isoftpull
        |                           +--> creditsafe
        |                           +--> plaid
        |                           +--> crm
        |
        +--------------------> Flowable BPMN
                                    |
                                    +--> Flowable DB
                                    +--> connectors

Дополнительно:
- Process Tracker
- Audit log
- Prometheus / Grafana
```

### Краткое описание

| Блок | Назначение |
| --- | --- |
| `Admin UI` | управление платформой |
| `Core API` | заявки, правила, безопасность, аудит |
| `Custom orchestration` | собственный execution path |
| `Flowable BPMN` | BPMN execution path |
| `Config DB` | заявки, конфиг, аудит, users |
| `Flowable DB` | процессы и BPMN-модели |

---

## 2. Technical architecture

### Контейнерная схема в текстовом виде

```text
Internet
  |
  v
nginx
  |
  +--> admin-ui
  +--> core-api
  +--> flowable-ui
  +--> grafana

core-api
  |
  +--> config-db
  +--> orchestrators
  +--> processors
  +--> prometheus

orchestrators
  |
  +--> custom-adapter
  |      |
  |      +--> connectors
  |      +--> report-parser
  |
  +--> flowable-adapter
         |
         +--> flowable-rest
         +--> connectors

flowable-rest
  |
  +--> flowable-db

flowable-ui
  |
  +--> flowable-db
```

### Таблица контейнеров

| Container | Технология | Роль |
| --- | --- | --- |
| `nginx` | nginx | edge / TLS / reverse proxy |
| `admin-ui` | React | операторский интерфейс |
| `core-api` | FastAPI | бизнес-API платформы |
| `orchestrators` | FastAPI | execution adapters |
| `processors` | FastAPI | parser и stop-factor |
| `flowable-rest` | Flowable | BPMN runtime |
| `flowable-ui` | Flowable UI | BPMN modeling / admin |
| `config-db` | PostgreSQL | platform state |
| `flowable-db` | PostgreSQL | BPMN and runtime state |
| `prometheus` | Prometheus | metrics |
| `grafana` | Grafana | dashboards |

---

## 3. System context

### Кто взаимодействует с системой

| Участник | Как взаимодействует |
| --- | --- |
| Мобильное приложение | отправляет заявку и запрашивает статус |
| Операторы / аналитики | управляют платформой через Admin UI |
| Flowable modelers | редактируют BPMN через Flowable UI |
| Внешние бюро / сервисы | участвуют в обработке заявки |
| SNP | получает финальное уведомление |

---

## 4. Ownership данных

| Данные | Где хранятся | Кто использует |
| --- | --- | --- |
| Requests | `config-db` | `core-api`, UI |
| Routing rules | `config-db` | `core-api`, UI |
| Pipeline steps | `config-db` | `core-api`, UI, orchestrators |
| Stop factors | `config-db` | `core-api`, processors, UI |
| Services registry | `config-db` | `core-api`, orchestrators, UI |
| Admin users | `config-db` | `core-api`, UI |
| Audit log | `config-db` | `core-api`, UI |
| Tracker events | `config-db` | `core-api`, UI |
| BPMN models | `flowable-db` | Flowable UI / engine |
| Process runtime state | `flowable-db` | Flowable runtime |

---

## 5. Request lifecycle

### Текстовый сценарий

```text
1. Клиент вызывает POST /api/v1/requests
2. Core API валидирует запрос, аутентифицирует gateway key и применяет rate limit
3. Заявка сохраняется в config-db
4. Выполняется PRE stop-factor check
5. Routing engine выбирает:
   - custom
   - flowable
6. Выбранный adapter исполняет маршрут
7. Формируется result
8. Выполняется POST stop-factor check
9. Core API сохраняет финальный статус
10. Пишется tracker и audit
11. Отправляется уведомление в SNP
```

### Таблица этапов

| Этап | Компонент |
| --- | --- |
| Auth / rate limit | `core-api` |
| PRE checks | `processors` |
| Routing | `core-api` |
| Execution | `orchestrators` + `flowable-rest` или connectors |
| Parsing | `processors` |
| POST checks | `processors` |
| Finalization | `core-api` |
| SNP notification | `core-api` |

---

## 6. Routing и canary

### Логика без диаграммы

```text
После приема Applicant Input v2 платформа формирует внутреннюю request model.

Если внутренний orchestration_mode != auto:
  использовать переданный режим

Если внутренний orchestration_mode = auto:
  идти по enabled routing rules по priority
  для каждой rule проверить:
    1. condition match
    2. sample_percent
    3. daily quota
  взять первую подходящую rule

Если ни одна rule не подошла:
  fallback = flowable
```

### Поля canary

| Поле | Назначение |
| --- | --- |
| `sample_percent` | доля auto-трафика |
| `sticky_field` | поле для детерминированного bucket |
| `daily_quota_enabled` | включает дневной лимит |
| `daily_quota_max` | максимум заявок в день |

---

## 7. UI control plane

### Страница `Scenarios`

Позволяет без shell-команд:

- перевести весь auto-трафик в `custom`
- включить custom reports chain
- настроить Flowable canary
- выключить все stop factors

### Страница `Routing rules`

Позволяет вручную настраивать:

- priority
- conditions
- target mode
- traffic share
- sticky field
- daily quota

### Страница `Services`

Позволяет:

- включать и выключать сервис
- менять URL
- менять timeout
- менять retry policy

---

## 8. Flowable integration model

### Базовый принцип

```text
Admin UI -> core-api -> Flowable REST
```

UI не должен обращаться к Flowable REST напрямую.

### Зачем это нужно

| Причина | Выигрыш |
| --- | --- |
| секреты на сервере | безопаснее |
| whitelist операций | меньше риск destructive actions |
| единый audit | лучше трассировка |
| нормализованные ответы | проще UI |

### BPMN source of truth

Если:

```text
FLOWABLE_AUTO_DEPLOY_BPMN=false
```

то production source of truth для BPMN находится в Flowable DB.

---

## 9. Production topology

### Публичный контур

| URL path | Target |
| --- | --- |
| `/` | `admin-ui` |
| `/api/` | `core-api` |
| `/flowable-ui/index.html` | `flowable-ui` |
| `/flowable-modeler/` | redirect -> `/flowable-ui/index.html` |
| `/flowable-admin/` | redirect -> `/flowable-ui/index.html` |
| `/flowable-idm/` | redirect -> `/flowable-ui/index.html` |
| `/grafana/` | `grafana` |

### Внутренний контур

Не публикуются наружу напрямую:

- `config-db`
- `flowable-db`
- `orchestrators`
- `processors`
- `flowable-rest`
- connectors

---

## 10. Trouble points

### Если заявки идут не туда

Проверять:

- enabled routing rules
- priority
- canary percent
- daily quota
- stale config cache

### Если Flowable UI недоступен

Проверять:

- `flowable-db`
- `flowable-rest`
- `flowable-ui`
- `nginx`
- `FLOWABLE_DB_PASSWORD`

### Если UI показывает старое поведение

Проверять:

- свежесть frontend bundle
- hard refresh / incognito
- фактическую версию контейнера

---

## 11. Рекомендуемое использование в Confluence

Если Mermaid не работает, этот документ можно использовать:

1. как отдельную wiki-страницу целиком
2. как source для ручной вёрстки в Confluence
3. как fallback-архитектуру для руководства и команды

## 12. Связанные документы

- `docs/ARCHITECTURE_EXECUTIVE_RU.md`
- `docs/ARCHITECTURE_TECHNICAL_RU.md`
- `docs/ARCHITECTURE_C4_RU.md`
- `docs/CONFLUENCE_READY_RU.md`
