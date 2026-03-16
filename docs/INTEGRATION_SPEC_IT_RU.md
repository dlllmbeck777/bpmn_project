# Credit Platform v5: ТЗ на интеграцию внешней IT-системы

## 1. Назначение

Документ описывает интеграцию внешней IT-системы с Credit Platform v5 после перехода на новый входной контракт `Applicant Input v2`.

Документ определяет:

- публичный API-контракт;
- структуру входных данных;
- формат ответа;
- правила аутентификации;
- polling статуса;
- требования к безопасности;
- критерии приемки.

## 2. Интеграционная модель

Внешняя система взаимодействует только с `core-api`.

Внешняя система не работает напрямую с:

- `admin-ui`;
- `flowable-rest`;
- `flowable-ui`;
- внутренними connectors/processors;
- внутренними admin endpoints.

Единственная публичная точка:

- `POST /api/v1/requests`

Дополнительно для статуса:

- `GET /api/v1/requests/{request_id}`

## 3. Базовый URL

Production:

```text
https://YOUR_DOMAIN
```

Пример:

```text
https://65.109.174.58
```

## 4. Аутентификация

Внешняя система использует только gateway key:

```http
X-Api-Key: <GATEWAY_API_KEY>
```

Нельзя использовать:

- `ADMIN_API_KEY`;
- `SENIOR_ANALYST_API_KEY`;
- `ANALYST_API_KEY`;
- `INTERNAL_API_KEY`.

## 5. Входной контракт Applicant Input v2

### 5.1 Endpoint

```http
POST /api/v1/requests
```

### 5.2 Headers

```http
Content-Type: application/json
X-Api-Key: <GATEWAY_API_KEY>
```

### 5.3 Request body

```json
{
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
}
```

### 5.4 Поля

| Поле | Обязательность | Описание |
| --- | --- | --- |
| `firstName` | обязательно | имя заявителя |
| `lastName` | обязательно | фамилия заявителя |
| `address` | обязательно | адрес |
| `city` | обязательно | город |
| `state` | обязательно | штат / регион |
| `zipCode` | обязательно | почтовый индекс |
| `ssn` | обязательно | идентификатор заявителя |
| `dateOfBirth` | обязательно | дата рождения в формате `YYYY-MM-DD` |
| `email` | обязательно | email |
| `phone` | обязательно | телефон |

## 6. Что внешний клиент больше не передает

В новом контракте внешний клиент не должен передавать:

- `request_id`;
- `customer_id`;
- `product_type`;
- `orchestration_mode`;
- вложенный `payload`.

Эти элементы становятся внутренними полями платформы.

## 7. Что делает платформа внутри

После приема заявки платформа должна:

1. валидировать applicant profile;
2. сгенерировать внутренний `request_id`;
3. сохранить snapshot заявки;
4. применить внутренний routing;
5. запустить `custom` или `flowable`;
6. вернуть клиенту идентификатор заявки и текущий результат.

## 8. Ответ на создание заявки

### 8.1 Успешный ответ

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

### 8.2 Важное правило

`request_id` возвращается платформой и дальше используется клиентом:

- для polling;
- для корреляции;
- для поиска заявки;
- для разбирательства инцидентов.

## 9. Получение статуса

### 9.1 Endpoint

```http
GET /api/v1/requests/{request_id}
```

### 9.2 Headers

```http
X-Api-Key: <GATEWAY_API_KEY>
```

### 9.3 Ожидаемые статусы

- `SUBMITTED`
- `RUNNING`
- `COMPLETED`
- `REVIEW`
- `REJECTED`
- `FAILED`

### 9.4 Рекомендуемый polling

Если в ответе на создание заявки пришел `RUNNING`:

1. подождать 2-5 секунд;
2. повторять `GET /api/v1/requests/{request_id}`;
3. остановить polling после получения финального статуса.

Финальные статусы:

- `COMPLETED`;
- `REVIEW`;
- `REJECTED`;
- `FAILED`.

## 10. Ошибки API

### `401 Unauthorized`

Причина:

- неверный `X-Api-Key`.

### `409 Conflict`

Причина:

- конфликт внутреннего request identity или повторная отправка, если на стороне платформы введен dedup.

### `422 Unprocessable Entity` или `400 Bad Request`

Причина:

- отсутствуют обязательные поля applicant profile;
- нарушен формат `dateOfBirth`;
- нарушен формат email/phone по правилам валидации канала.

### `429 Too Many Requests`

Причина:

- превышен rate limit.

### `502/503`

Причина:

- временная техническая ошибка платформы или зависимых сервисов.

## 11. Требования к безопасности

- только HTTPS;
- `GATEWAY_API_KEY` не должен попадать в клиентский код в открытом виде;
- рекомендуется вызывать платформу через BFF / middleware слой внешней системы;
- `ssn`, `dateOfBirth`, `address`, `email`, `phone` считаются чувствительными полями;
- логирование на стороне интегратора должно исключать открытый вывод `ssn`.

## 12. Минимальный тестовый сценарий

### Создание заявки

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

### Получение статуса

```bash
curl -k https://YOUR_DOMAIN/api/v1/requests/REQ-2026-000123 \
  -H "X-Api-Key: YOUR_GATEWAY_API_KEY"
```

## 13. Критерии приемки

Интеграция считается принятой, если:

1. внешняя IT-система успешно отправляет заявку в формате Applicant Input v2;
2. платформа возвращает сгенерированный `request_id`;
3. внешний клиент получает статус по `request_id`;
4. внешний клиент не обязан знать внутренние route modes;
5. внешняя система использует только `GATEWAY_API_KEY`;
6. документация и тестовые примеры совпадают с реальным agreed input contract.
