# API Cheatsheet RU

Короткая практическая шпаргалка для ручной проверки API через `curl`, Postman и для быстрого онбординга команды.

## Базовые правила

Есть два разных типа доступа:

1. `Gateway access`
Используется для подачи заявок в платформу.

- endpoint: `POST /api/v1/requests`
- header: `X-Api-Key: <GATEWAY_API_KEY>`
- `X-User-Role` не нужен

2. `Admin / UI access`
Используется для всех конфигурационных и операционных endpoint'ов:

- `routing-rules`
- `stop-factors`
- `pipeline`
- `services`
- `users`
- `audit`
- `flowable`
- `requests` list/detail/tracker из админского контура

Для этого используются:

- либо `api_key`, полученный после `POST /api/v1/auth/login`
- либо постоянный `ADMIN_API_KEY`

И обязательно указывается:

- `X-User-Role: admin`

## Частая ошибка

Неправильно:

```http
X-Api-Key: <GATEWAY_API_KEY>
X-User-Role: admin
```

Это приводит к ошибке:

```text
401 invalid api key for selected role
```

Причина: `GATEWAY_API_KEY` не является admin-session key и не подходит для UI/config endpoint'ов.

## 1. Логин в админку

```bash
curl -k https://65.109.174.58/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}'
```

Ожидаемый ответ:

```json
{
  "status": "ok",
  "username": "admin",
  "role": "admin",
  "api_key": "SESSION_TOKEN_HERE"
}
```

Дальше использовать:

- `SESSION_TOKEN_HERE` как `X-Api-Key`
- `admin` как `X-User-Role`

## 2. Создать заявку

Используется `GATEWAY_API_KEY`.

```bash
curl -k -X POST https://65.109.174.58/api/v1/requests \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_GATEWAY_API_KEY" \
  -d '{
    "request_id": "REQ-1001",
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

## 3. Получить routing rules

Используется admin session token или `ADMIN_API_KEY`.

```bash
curl -k https://65.109.174.58/api/v1/routing-rules \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 4. Обновить routing rule

Пример: включить `Auto -> Custom default`.

```bash
curl -k -X PUT https://65.109.174.58/api/v1/routing-rules/4 \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin" \
  -d '{
    "name": "Auto -> Custom default",
    "priority": 0,
    "condition_field": "orchestration_mode",
    "condition_op": "eq",
    "condition_value": "auto",
    "target_mode": "custom",
    "enabled": true,
    "meta": {}
  }'
```

## 5. Получить список заявок

```bash
curl -k "https://65.109.174.58/api/v1/requests?limit=20" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 6. Получить карточку заявки

```bash
curl -k https://65.109.174.58/api/v1/requests/REQ-1001 \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 7. Получить tracker заявки

```bash
curl -k https://65.109.174.58/api/v1/requests/REQ-1001/tracker \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 8. Получить services

```bash
curl -k https://65.109.174.58/api/v1/services \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 9. Обновить service

Пример: выключить `creditsafe`.

```bash
curl -k -X PUT https://65.109.174.58/api/v1/services/creditsafe \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin" \
  -d '{
    "id": "creditsafe",
    "name": "Creditsafe",
    "type": "connector",
    "base_url": "http://creditsafe:8102",
    "health_path": "/health",
    "enabled": false,
    "timeout_ms": 15000,
    "retry_count": 2,
    "endpoint_path": "/pull",
    "meta": {}
  }'
```

## 10. Получить stop factors

```bash
curl -k https://65.109.174.58/api/v1/stop-factors \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 11. Получить pipeline

```bash
curl -k "https://65.109.174.58/api/v1/pipeline-steps?pipeline_name=default" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 12. Когда использовать какой ключ

### Для подачи заявок

Использовать:

```text
X-Api-Key: GATEWAY_API_KEY
```

### Для конфигурации и операционного управления

Использовать:

```text
X-Api-Key: SESSION_TOKEN from /api/v1/auth/login
X-User-Role: admin
```

или:

```text
X-Api-Key: ADMIN_API_KEY
X-User-Role: admin
```

## 13. Мини-шпаргалка в одной строке

- `POST /api/v1/requests` -> `GATEWAY_API_KEY`
- всё админское -> `login session token` или `ADMIN_API_KEY` + `X-User-Role`
