# Mock Bureaus Service

## Назначение

`mock-bureaus` — временный отдельный тестовый сервис для имитации ответов:

- `isoftpull`
- `creditsafe`
- `plaid`

Сервис нужен для функционального тестирования Flowable, `custom`-режима, stop factors и UI без подключения реальных внешних провайдеров.

## Что он умеет

- отдавать ответ в формате, близком к реальным интеграциям;
- переключать готовые сценарии по каждому провайдеру;
- менять ключевые цифры без изменения кода;
- работать как отдельный контейнер, не затрагивая реальные connector-сервисы;
- использоваться через обычную настройку `Services` в admin UI.

## Как запустить локально

```bash
docker compose --profile mock up -d --build mock-bureaus
```

Сервис поднимется на:

```text
http://localhost:8110
```

## Как запустить на сервере

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod --profile mock up -d --build mock-bureaus
```

## Как подключить его к платформе

В admin UI открой `Services` и замени `base_url`:

- `isoftpull` -> `http://mock-bureaus:8110`
- `creditsafe` -> `http://mock-bureaus:8110`
- `plaid` -> `http://mock-bureaus:8110`

Важно:

- `endpoint_path` менять не нужно;
- `isoftpull` продолжает ходить в `/api/pull`;
- `creditsafe` продолжает ходить в `/api/report`;
- `plaid` продолжает ходить в `/api/accounts`.

## API mock-сервиса

### Health

```http
GET /health
```

### Каталог сценариев

```http
GET /api/v1/mock/catalog
```

### Текущая конфигурация

```http
GET /api/v1/mock/config
```

### Plaid tracking URL

```http
GET /api/v1/plaid/link/{tracking_id}
```

Endpoint нужен для ручной проверки `trackingUrl/reportUrl`, которые mock возвращает в Plaid-сценариях.

### Сменить конфигурацию одного провайдера

```http
PUT /api/v1/mock/config/{provider}
Content-Type: application/json
```

Пример:

```json
{
  "scenario": "reject_collections_6",
  "controls": {},
  "overrides": {}
}
```

### Сменить конфигурацию сразу для нескольких провайдеров

```http
PUT /api/v1/mock/config
Content-Type: application/json
```

Пример:

```json
{
  "isoftpull": {
    "scenario": "reject_score_550"
  },
  "creditsafe": {
    "scenario": "reject_alerts_2"
  },
  "plaid": {
    "scenario": "pending_link"
  }
}
```

### Сбросить конфигурацию к умолчанию

```http
POST /api/v1/mock/reset
```

## Поддерживаемые сценарии

### iSoftPull

- `pass_775`
- `reject_score_550`
- `reject_collections_6`
- `no_hit`

### Creditsafe

- `clean_72`
- `reject_alerts_2`
- `no_data`

### Plaid

- `pending_link`
- `accounts_3`
- `no_accounts`
- `failed_missing_ssn`

## Какие цифры можно менять через controls

### iSoftPull

- `creditScore`
- `collectionCount`
- `bureauHit`
- `status`
- `intelligenceIndicator`

Пример:

```bash
curl -X PUT http://localhost:8110/api/v1/mock/config/isoftpull \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "pass_775",
    "controls": {
      "creditScore": 562,
      "collectionCount": 7
    }
  }'
```

### Creditsafe

- `creditScore`
- `complianceAlertCount`
- `derogatoryCount`
- `status`
- `intelligenceIndicator`

Пример:

```bash
curl -X PUT http://localhost:8110/api/v1/mock/config/creditsafe \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "clean_72",
    "controls": {
      "creditScore": 68,
      "complianceAlertCount": 3,
      "derogatoryCount": 3
    }
  }'
```

### Plaid

- `accountsFound`
- `cashflowStability`
- `status`
- `intelligenceIndicator`
- `errorMessage`

Пример:

```bash
curl -X PUT http://localhost:8110/api/v1/mock/config/plaid \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "accounts_3",
    "controls": {
      "accountsFound": 5,
      "cashflowStability": "GOOD"
    }
  }'
```

## overrides

`overrides` нужен, если надо заменить конкретные поля ответа один в один, включая вложенный JSON.

Пример:

```json
{
  "scenario": "clean_72",
  "overrides": {
    "rawResponse": {
      "businessCredit": {
        "riskScoreDescription": "Custom Risk Description"
      }
    }
  }
}
```

## Рекомендуемый порядок тестирования

1. Запустить `mock-bureaus`.
2. Переключить `base_url` у `isoftpull`, `creditsafe`, `plaid` на `http://mock-bureaus:8110`.
3. Поставить нужные сценарии через API mock-сервиса.
4. Отправить заявку в платформу.
5. Проверить `Requests`, tracker, итоговый decision в Flowable или `custom`.

## Ограничения

- конфигурация хранится в памяти контейнера;
- после restart mock-сервиса активные сценарии сбрасываются;
- сервис предназначен для тестирования и демо, не для production decisioning.
