# Credit Platform v5: Руководство по эксплуатации

## Назначение

Этот документ описывает, как запускать, настраивать и сопровождать платформу в production и test окружениях.

Документ рассчитан на:

- администратора платформы
- senior analyst
- DevOps / backend инженера
- операционную команду

## Состав системы

Платформа состоит из следующих логических блоков:

- `admin-ui`
  интерфейс управления платформой
- `core-api`
  центральный API, хранение конфигурации, заявки, аудит, авторизация, routing
- `orchestrators`
  адаптеры `flowable` и `custom`
- `processors`
  парсер отчета и stop-factor processor
- `connectors`
  интеграции `isoftpull`, `creditsafe`, `plaid`, `crm`
- `flowable-rest`
  движок BPMN
- `flowable-ui`
  Flowable Modeler / Admin / IDM
- `config-db`
  основная PostgreSQL БД платформы
- `flowable-db`
  отдельная PostgreSQL БД Flowable
- `nginx`
  production reverse proxy
- `prometheus` / `grafana`
  наблюдаемость

## Основные бизнес-сценарии

### 1. Весь auto-трафик в custom

Используется, когда нужно временно исключить Flowable из обработки, но оставить автоматический путь в собственном адаптере.

Что делаем в UI:

1. Открыть `Scenarios`
2. Нажать `Route all auto traffic to custom`

Результат:

- все заявки с `orchestration_mode=auto` идут в `custom`
- если других активных правил выше по приоритету нет, fallback становится `custom`

### 2. Custom reports chain

Используется, когда в `custom` нужно запускать только отчеты:

- `isoftpull`
- `creditsafe`
- `plaid`

Что делаем в UI:

1. Открыть `Scenarios`
2. Нажать `Prepare custom reports chain`

Результат:

- для `custom`-режима включается цепочка отчетных сервисов
- остальные pipeline steps для `custom` будут `SKIPPED`

### 3. Flowable canary

Используется, когда только часть auto-трафика должна идти в Flowable.

Что делаем в UI:

1. Открыть `Scenarios`
2. В блоке `Flowable canary` заполнить:
   - `Percent`
   - `Sticky field`
   - `Enabled`
3. При необходимости включить:
   - `Daily quota mode`
   - `Max requests per day`
4. Нажать `Apply`

Результат:

- только заданная доля auto-трафика идет в `flowable`
- остальной auto-трафик идет в `custom`
- при включенном `Daily quota mode` Flowable перестает получать заявки после достижения дневного лимита

### 4. Полное отключение stop factors

Используется для диагностики маршрута и проверки чистого happy-path без бизнес-блокировок.

Что делаем в UI:

1. Открыть `Scenarios`
2. Нажать `Disable all stop factors`

Результат:

- все активные stop factors становятся `disabled`
- решения `REVIEW` / `REJECTED`, зависящие от них, временно не применяются

### 5. Управление сервисами

Используется для отключения интеграции, смены URL или корректировки retry/timeout.

Что делаем в UI:

1. Открыть `Services`
2. Использовать:
   - `Enable`
   - `Disable`
   - `Edit`

Что можно менять:

- `base_url`
- `endpoint_path`
- `timeout_ms`
- `retry_count`
- `enabled`

## Production deployment

### Вариант 1. One-command bootstrap

```bash
DOMAIN=your-domain.com bash scripts/deploy-prod.sh
```

Что делает скрипт:

- создает `.env.prod`, если его нет
- подставляет `DOMAIN`
- настраивает `CORS_ORIGINS`
- генерирует self-signed TLS, если сертификатов нет
- запускает production stack

### Вариант 2. Ручной запуск

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --build
```

## Production endpoints

- `https://YOUR_DOMAIN/`
  Admin UI
- `https://YOUR_DOMAIN/api/`
  Core API
- `https://YOUR_DOMAIN/flowable-modeler/`
  Flowable Modeler
- `https://YOUR_DOMAIN/flowable-admin/`
  Flowable Admin
- `https://YOUR_DOMAIN/flowable-idm/`
  Flowable IDM
- `https://YOUR_DOMAIN/grafana/`
  Grafana

## Управление BPMN-моделями

### Источник истины в production

Если в production используется Flowable Modeler как основной редактор:

- `flowable-ui` должен быть включен
- `FLOWABLE_AUTO_DEPLOY_BPMN=false`

Тогда BPMN-модель редактируется через Flowable UI и хранится в Flowable DB.

### Важно

Если process definition key меняется, orchestrator может перестать корректно запускать нужный процесс.

Рекомендуется:

- сохранять существующий `processDefinitionKey`
- менять модель через версионирование внутри Flowable
- фиксировать критичные изменения в Git и release notes

## Пользователи и роли

Поддерживаются роли:

- `analyst`
- `senior_analyst`
- `admin`

### Права по умолчанию

- `analyst`
  просмотр заявок, tracker, flowable engine, audit, dashboard
- `senior_analyst`
  все права analyst + изменение routing, pipeline, stop factors, services, scenarios
- `admin`
  все права senior analyst + users & access

## Основные страницы UI

### Dashboard

Используется для общего обзора состояния платформы.

### Scenarios

Главная операционная страница для быстрого переключения режимов работы без ручного редактирования нескольких сущностей.

### Services

Используется для управления доступностью и параметрами внешних интеграций.

### Routing rules

Используется для ручного управления маршрутизацией:

- target mode
- priority
- condition
- sample percent
- sticky field
- daily quota

### Stop factors

Используется для включения/отключения пред- и пост-проверок.

### Pipeline

Используется для управления порядком и составом шагов pipeline, включая mode-specific skips.

### Requests

Используется для просмотра заявок.

Поддерживает:

- фильтры по статусу
- фильтры по дате и времени
- открытие детальной карточки заявки

### Process tracker

Используется для просмотра прохождения заявки по этапам.

### Flowable engine

Используется для просмотра:

- process instances
- variables
- jobs
- engine state

### Audit log

Используется для просмотра изменений конфигурации и действий операторов.

### Users & access

Используется для:

- создания пользователя
- смены роли
- смены пароля
- отключения пользователя
- ревокации сессии

## Проверка после настройки сценария

Рекомендуемый порядок:

1. Применить сценарий в `Scenarios`
2. Подождать до 30 секунд или перезапустить `orchestrators`
3. Отправить тестовую заявку
4. Проверить:
   - `selected_mode`
   - `status`
   - `Process tracker`
   - `Flowable engine`, если заявка ушла в Flowable

## Тестовый запрос

```bash
curl -k -X POST https://YOUR_DOMAIN/api/v1/requests \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_GATEWAY_API_KEY" \
  -d '{
    "request_id": "REQ-TEST-001",
    "customer_id": "CUST-001",
    "iin": "900101123456",
    "product_type": "loan",
    "orchestration_mode": "auto",
    "payload": {
      "amount": 5000,
      "currency": "USD",
      "term_months": 12
    }
  }'
```

## Нагрузочное тестирование

Сценарий лежит в:

- `scripts/stress-test-requests.js`

Быстрый запуск:

```bash
BASE_URL=https://YOUR_DOMAIN \
GATEWAY_API_KEY=YOUR_GATEWAY_API_KEY \
VUS=5 \
DURATION=30s \
k6 run ./scripts/stress-test-requests.js
```

Важно:

- тест создает реальные заявки
- при маленьком `RATE_LIMIT_PER_MIN` большая часть запросов может получить `429`

## Диагностика и troubleshooting

### UI не логинится

Проверить:

- корректный `API Base URL`
- `ADMIN_LOGIN_PASSWORD`
- пользователя в `admin_users`
- `core-api` health

### Заявки идут не в тот режим

Проверить:

- активные `routing_rules`
- их `priority`
- включена ли canary rule
- не достигнут ли daily quota
- не закэширована ли старая конфигурация в `orchestrators`

### Flowable UI недоступен

Проверить:

- `flowable-db`
- `flowable-rest`
- `flowable-ui`
- `nginx`
- корректность `FLOWABLE_DB_PASSWORD`

Если Flowable DB была создана с конфликтующим паролем, использовать:

```bash
bash scripts/reset-flowable.sh
```

### Нужно полностью пересобрать production

Использовать:

```bash
bash scripts/rebuild-prod.sh
```

Важно:

- будет удалено текущее runtime-состояние БД
- использовать только осознанно

## Рекомендации по эксплуатации

- держать все изменения routing и pipeline под аудитом
- не редактировать сразу несколько критичных сценариев без тестовой заявки
- использовать `Scenarios` для типовых режимов, а `Routing rules` и `Pipeline` для точной настройки
- для production фиксировать изменения в release notes
- перед повышением canary процента сначала проверять Flowable health и success ratio
