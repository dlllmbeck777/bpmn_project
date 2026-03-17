# Credit Platform v5: Архитектура для руководства

## Назначение

Эта схема показывает платформу на уровне управленческого обзора:

- где находится точка входа
- какие основные домены системы существуют
- где принимаются решения
- где хранится состояние
- как организован контроль и наблюдаемость

## Executive view

```mermaid
flowchart LR
    classDef edge fill:#ffffff,stroke:#cbd5e1,color:#0f172a,stroke-width:1.5px;
    classDef ui fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px;
    classDef api fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px;
    classDef orch fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;
    classDef ext fill:#fff7ed,stroke:#ea580c,color:#9a3412,stroke-width:2px;
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px;
    classDef ops fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:2px;

    Client["Клиенты и операторы"]:::edge
    Admin["Admin UI<br/>единая точка управления"]:::ui
    Api["Core API<br/>правила, заявки, аудит, безопасность"]:::api

    subgraph Decision["Движок принятия решений"]
        Routing["Routing и сценарии"]:::api
        Stops["Stop factors"]:::api
        Pipeline["Pipeline"]:::api
    end

    subgraph Execution["Исполнение"]
        Custom["Custom orchestration"]:::orch
        Flowable["Flowable BPMN"]:::orch
    end

    subgraph Integrations["Внешние сервисы и отчеты"]
        Isoft["isoftpull"]:::ext
        Creditsafe["creditsafe"]:::ext
        Plaid["plaid"]:::ext
    end

    subgraph Data["Хранилища"]
        ConfigDb["Config DB<br/>заявки, конфиг, аудит, users"]:::data
        FlowableDb["Flowable DB<br/>процессы, модели, engine state"]:::data
    end

    subgraph Control["Контроль и наблюдаемость"]
        Tracker["Process Tracker"]:::ops
        Audit["Audit log"]:::ops
        Metrics["Prometheus / Grafana"]:::ops
    end

    Client --> Admin
    Client --> Api
    Admin --> Api
    Api --> Routing
    Api --> Stops
    Api --> Pipeline
    Routing --> Custom
    Routing --> Flowable
    Custom --> Isoft
    Custom --> Creditsafe
    Custom --> Plaid
    Flowable --> Isoft
    Flowable --> Creditsafe
    Flowable --> Plaid
    Api --> ConfigDb
    Flowable --> FlowableDb
    Api --> Tracker
    Api --> Audit
    Api --> Metrics
```

## Что важно для руководства

### 1. Платформа разделена на два независимых маршрута исполнения

- `custom`
  быстрый управляемый маршрут для прикладной логики и интеграций
- `flowable`
  BPMN-маршрут для визуального моделирования и контроля бизнес-процессов

Это позволяет:

- гибко переключать трафик
- вводить canary rollout
- безопасно тестировать новые процессы

### 2. Вся критичная конфигурация управляется централизованно

Через `Admin UI` можно менять:

- routing
- сценарии работы
- stop factors
- pipeline
- сервисы
- пользователей и доступы

### 3. Система разделяет бизнес-логику и исполнение

`Core API` принимает решение, какой путь выбрать, а `custom` и `flowable` уже исполняют маршрут.

Это снижает зависимость платформы от одного движка и дает гибкость эксплуатации.

### 4. Есть полный контур контроля

- `Process Tracker`
  показывает, как прошла конкретная заявка
- `Audit log`
  показывает, кто и что менял
- `Prometheus / Grafana`
  показывают техническое состояние платформы

## Бизнес-ценность

Платформа дает компании:

- быстрый ввод новых маршрутов проверки
- снижение операционного риска при изменениях
- контроль над canary rollout
- прозрачность заявок и решений
- готовый operational UI без ручного shell-управления

## Ключевые управленческие сценарии

Через UI можно:

1. Перевести весь auto-трафик в `custom`
2. Запустить Flowable только на доле трафика
3. Ограничить Flowable по дневному лимиту
4. Отключить блокирующие stop factors
5. Отключить проблемный интеграционный сервис

## Ключевые риски и как они закрыты

### Риск: изменение процесса ломает поток заявок

Снижается за счет:

- canary rollout
- fallback на `custom`
- UI-сценариев

### Риск: непрозрачность причин отказа или сбоя

Снижается за счет:

- request tracker
- audit log
- flowable ops

### Риск: ручные изменения в production

Снижается за счет:

- централизованного Admin UI
- сценариев `Scenarios`
- production deployment scripts
