# Credit Platform v5: ТЗ на интеграцию с SNP

## 1. Назначение

Документ описывает финальную outbound-интеграцию Credit Platform v5 с SNP.

SNP находится в конце цепочки и получает:

- внутренний `request_id`;
- финальный статус заявки;
- route mode, которым заявка была обработана;
- итоговый normalized result;
- snapshot исходного applicant profile, пришедшего по `Applicant Input v2`.

## 2. Источник входных данных

Входной контракт платформы описан отдельно:

- [INTEGRATION_SPEC_IT_RU.md](./INTEGRATION_SPEC_IT_RU.md)

Исходная заявка приходит в платформу в формате:

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

## 3. Когда вызывается SNP

SNP вызывается после финализации заявки, когда платформа уже получила один из финальных статусов:

- `COMPLETED`;
- `REVIEW`;
- `REJECTED`;
- `FAILED` — по отдельной business policy, если требуется уведомлять о техническом результате.

## 4. Требования к outbound payload

SNP должен получать как минимум:

| Поле | Обязательность | Описание |
| --- | --- | --- |
| `request_id` | обязательно | внутренний идентификатор заявки |
| `status` | обязательно | финальный статус |
| `mode` | обязательно | фактический контур обработки (`custom` / `flowable`) |
| `result` | обязательно | нормализованный результат обработки |
| `post_stop_factor` | опционально | итог проверки post-stop factors |
| `source_applicant` | обязательно | исходный applicant snapshot |

## 5. Рекомендуемый outbound envelope

```json
{
  "request_id": "REQ-2026-000123",
  "status": "COMPLETED",
  "mode": "flowable",
  "source_applicant": {
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
  },
  "result": {
    "status": "COMPLETED",
    "adapter": "flowable"
  },
  "post_stop_factor": {
    "decision": "PASS"
  }
}
```

## 6. Требования к SNP endpoint

SNP endpoint должен:

- принимать HTTPS POST;
- возвращать корректный HTTP status code;
- логировать `request_id`;
- быть идемпотентным на случай повторной доставки;
- поддерживать timeout и retry policy платформы.

## 7. Обработка ошибок

### Ошибки доставки

Если SNP недоступен или вернул error status:

- платформа должна зафиксировать попытку в `snp_notifications`;
- ошибка не должна ломать уже финализированную заявку;
- должна быть возможность повторной отправки или расследования по audit/tracker.

### Ошибки контракта

Если SNP не принимает agreed payload:

- проблема считается контрактной;
- должна фиксироваться как интеграционный инцидент;
- бизнес-статус заявки не должен теряться.

## 8. Безопасность

В outbound payload присутствуют персональные данные.

Необходимо согласовать:

- masking policy для `ssn`;
- необходимость передачи полного адреса;
- retention policy в логах SNP;
- transport security и аутентификацию канала.

## 9. Критерии приемки

Интеграция с SNP считается принятой, если:

1. SNP получает `request_id`, `status`, `mode`, `result` и `source_applicant`;
2. payload соответствует Applicant Input v2 на стороне source snapshot;
3. ошибка доставки SNP не ломает финализацию заявки;
4. все попытки доставки отражаются в audit / notification log;
5. контракт согласован с IT-командой SNP и эксплуатацией.
