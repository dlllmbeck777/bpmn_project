# Credit Platform v5: API шпаргалка

## 1. Какой ключ использовать

### Gateway-запросы

Используются для подачи заявки во внешний публичный API.

Headers:

```http
Content-Type: application/json
X-Api-Key: <GATEWAY_API_KEY>
```

### Admin-запросы

Используются для UI и операторских endpoints.

После `POST /api/v1/auth/login` использовать:

```http
X-Api-Key: <session token>
X-User-Role: admin
```

## 2. Создание заявки по Applicant Input v2

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

Важно:

- `request_id` не передается клиентом;
- `request_id` генерирует платформа;
- routing выбирается платформой автоматически.

## 3. Пример ответа на создание заявки

```json
{
  "request_id": "REQ-2026-000123",
  "selected_mode": "flowable",
  "result": {
    "status": "RUNNING",
    "adapter": "flowable",
    "request_id": "REQ-2026-000123"
  }
}
```

## 4. Получить статус заявки

```bash
curl -k https://YOUR_DOMAIN/api/v1/requests/REQ-2026-000123 \
  -H "X-Api-Key: YOUR_GATEWAY_API_KEY"
```

## 5. Логин в админку

```bash
curl -k https://YOUR_DOMAIN/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}'
```

## 6. Получить routing rules

```bash
curl -k https://YOUR_DOMAIN/api/v1/routing-rules \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 7. Обновить routing rule

```bash
curl -k -X PUT https://YOUR_DOMAIN/api/v1/routing-rules/4 \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin" \
  -d '{
    "name": "Auto -> Custom default",
    "priority": 0,
    "condition_field": "channel",
    "condition_op": "eq",
    "condition_value": "default",
    "target_mode": "custom",
    "enabled": true,
    "meta": {}
  }'
```

## 8. Получить services

```bash
curl -k https://YOUR_DOMAIN/api/v1/services \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 9. Получить stop factors

```bash
curl -k https://YOUR_DOMAIN/api/v1/stop-factors \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 10. Получить pipeline

```bash
curl -k "https://YOUR_DOMAIN/api/v1/pipeline-steps?pipeline_name=default" \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 11. Получить tracker заявки

```bash
curl -k https://YOUR_DOMAIN/api/v1/requests/REQ-2026-000123/tracker \
  -H "X-Api-Key: YOUR_SESSION_TOKEN" \
  -H "X-User-Role: admin"
```

## 12. Частая ошибка

Неправильно:

```http
X-Api-Key: <GATEWAY_API_KEY>
X-User-Role: admin
```

Почему это неверно:

- gateway key не является admin session token;
- backend ждет admin-compatible key;
- в ответ будет `401 invalid api key for selected role`.
