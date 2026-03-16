# Credit Platform v5: Руководство по эксплуатации

## Назначение

Документ описывает эксплуатацию production/test окружения после перехода на новый входной контракт `Applicant Input v2`.

Основная идея:

- внешняя IT-система передает flat applicant profile;
- `request_id` генерируется платформой;
- routing выбирается внутри платформы;
- stop factors блокируют заявку только при наличии активных правил.

## Состав системы

- `admin-ui` — UI управления;
- `core-api` — публичный API, конфигурация, заявки, audit;
- `orchestrators` — `custom` и `flowable`;
- `processors` — parser и stop-factor processor;
- `connectors` — `isoftpull`, `creditsafe`, `plaid`, `crm`;
- `flowable-rest` / `flowable-ui` — BPMN runtime и modeler;
- `config-db` / `flowable-db` — БД платформы и Flowable;
- `nginx` — production reverse proxy;
- `prometheus` / `grafana` — мониторинг.

## Основной эксплуатационный принцип

Внешняя система больше не управляет маршрутом через request body.

Операторы управляют поведением системы через UI:

- `Orchestration`
  - `Routing`
  - `Stop factors`
  - `Pipeline`
- `Services`
- `Requests`
- `Process tracker`
- `Flowable engine`

## Routing в UI

Поддерживаются три режима:

### 1. Все auto в custom

Используется, когда весь поток нужно временно увести из Flowable.

Ожидаемый результат:

- все новые заявки идут в `custom`;
- заявка не зависит от внешнего поля `orchestration_mode`.

### 2. Все auto в flowable

Используется, когда весь поток должен идти через BPMN engine.

Ожидаемый результат:

- все новые заявки идут в `flowable`.

### 3. Rule-based routing

Используется, когда нужен выбор маршрута по правилам.

Ожидаемый результат:

- решение принимается по `priority` и условиям правил;
- fallback rule обязателен.

## Stop factors

Базовое правило эксплуатации:

- если хотя бы одно активное правило есть, оно участвует в принятии решения;
- если активных правил нет, заявка проходит дальше автоматически.

Это означает, что “пустой набор правил” не должен приводить к `REJECTED` или `REVIEW`.

## Pipeline

`Pipeline` определяет порядок и состав вызовов сервисов.

Оператор может:

- выключить шаг;
- включить шаг;
- настроить skip policy по mode;
- оставить маршрут живым даже при временно отключенном connector.

Если сервис или шаг отключен корректно, ожидаемое поведение:

- шаг помечается как `SKIPPED`;
- заявка не падает только из-за того, что этот шаг отключен намеренно.

## Services

В `Services` можно:

- менять `base_url`;
- менять `endpoint_path`;
- менять `timeout_ms`;
- менять `retry_count`;
- включать/выключать сервис.

Ожидаемое поведение при disable:

- если сервис отключен оператором, orchestrator не должен пытаться его вызвать;
- tracker должен показать skip / disable причину.

## Production deployment

### Быстрый запуск

```bash
DOMAIN=your-domain.com bash scripts/deploy-prod.sh
```

### Полный production запуск

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --build
```

## Полная пересборка

Если конфигурация и runtime-state разошлись:

```bash
bash scripts/rebuild-prod.sh
```

Важно:

- будет удалено текущее runtime-состояние БД;
- использовать осознанно.

## Flowable modeler

Production endpoint:

- `https://YOUR_DOMAIN/flowable-modeler/`

Рекомендуемый режим:

- `FLOWABLE_AUTO_DEPLOY_BPMN=false`

Тогда BPMN source of truth находится в Flowable DB / Flowable UI.

## Проверка после изменения routing или pipeline

Рекомендуемый порядок:

1. применить изменение в UI;
2. подождать до 30 секунд или перезапустить `orchestrators`;
3. отправить новую тестовую заявку;
4. проверить:
   - `selected_mode`;
   - итоговый `status`;
   - `Requests`;
   - `Process tracker`;
   - `Flowable engine`, если маршрут ушел в Flowable.

## Тестовый запрос Applicant Input v2

```bash
curl -k -X POST https://YOUR_DOMAIN/api/v1/requests \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_GATEWAY_API_KEY" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "address": "123 Main Street",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "ssn": "123456789",
    "dateOfBirth": "1985-06-15",
    "email": "john@example.com",
    "phone": "555-123-4567"
  }'
```

Ожидаемый ответ:

- платформа вернет сгенерированный `request_id`;
- будет указан `selected_mode`;
- `result.status` будет либо финальным, либо `RUNNING`.

## Диагностика

### UI не логинится

Проверить:

- корректный `API Base URL`;
- актуальный пароль admin-user;
- `core-api` health;
- устаревший session token в браузере.

### Заявки идут не туда

Проверить:

- активный routing mode;
- fallback rule;
- cached config в `orchestrators`;
- не остались ли старые правила выше по `priority`.

### Flowable дает ENGINE_ERROR

Проверить:

- `flowable-rest` и `flowable-ui`;
- правильный `FLOWABLE_PASSWORD`;
- задеплоен ли process definition key;
- логи `orchestrators` и `flowable-rest`;
- internal auth между `orchestrators`, `processors` и `core-api`.

### Services пустые в UI

Проверить:

- валидность UI session;
- корректность пары `X-Api-Key` + `X-User-Role`;
- не остался ли старый browser storage после rebuild.

## Практические рекомендации

- не менять сразу routing, stop factors и pipeline без тестовой заявки;
- держать хотя бы одно явное fallback rule;
- при пустом наборе stop factors считать систему “open flow”, а не “blocked flow”;
- после rebuild открывать UI в `Incognito` или с `Ctrl+F5`;
- фиксировать изменения интеграционного контракта в release notes и Confluence.
