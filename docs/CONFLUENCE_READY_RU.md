# Credit Platform v5: пакет страниц для Confluence

## Рекомендуемая структура space

### 1. Overview

- цель платформы;
- high-level архитектура;
- ключевые роли;
- production landscape.

### 2. Technical Specification

Использовать:

- [TECH_SPECIFICATION_RU.md](./TECH_SPECIFICATION_RU.md)

Главный акцент:

- внешний контракт `Applicant Input v2`;
- внутренний `request_id`;
- routing как внутренняя функция платформы;
- stop factors с default-pass поведением.

### 3. IT Integration

Использовать:

- [INTEGRATION_SPEC_IT_RU.md](./INTEGRATION_SPEC_IT_RU.md)

Ключевой блок для вставки:

> Внешняя IT-система передает в платформу только flat applicant profile.  
> `request_id` не передается снаружи и генерируется платформой.  
> Routing не задается клиентом и управляется через конфигурацию платформы.

### 4. SNP Integration

Использовать:

- [INTEGRATION_SPEC_SNP_RU.md](./INTEGRATION_SPEC_SNP_RU.md)

Ключевой блок для вставки:

> SNP получает финальный результат обработки вместе с внутренним `request_id` и snapshot исходного applicant profile.

### 5. Operations

Использовать:

- [OPERATIONS_RUNBOOK_RU.md](./OPERATIONS_RUNBOOK_RU.md)

### 6. API Quick Reference

Использовать:

- [API_CHEATSHEET_RU.md](./API_CHEATSHEET_RU.md)

## Вставка для страницы “Внешний контракт”

### Applicant Input v2

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

### Правила контракта

- внешний клиент не передает `request_id`;
- внешний клиент не передает `orchestration_mode`;
- платформа сама генерирует `request_id`;
- платформа сама выбирает route mode;
- статус заявки читается по `request_id`, который вернулся в ответе.
