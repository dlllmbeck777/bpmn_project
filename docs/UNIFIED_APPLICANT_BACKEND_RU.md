# Unified Applicant Backend

Платформа теперь закладывает единый внешний applicant/credit backend как источник:

- applicant CRUD
- provider checks
- final credit reports
- Plaid tracking link/status

Базовый upstream по умолчанию:

```text
http://18.119.38.114
```

Source of truth для URL:

1. service registry entry `credit-backend`
2. fallback env `CREDIT_BACKEND_DEFAULT_URL`

## Что изменилось

- `POST /api/v1/requests` перед оркестрацией создаёт внешнего applicant и сохраняет `external_applicant_id` в request.
- `custom` и `flowable` прокидывают `external_applicant_id` дальше в connector steps.
- `isoftpull`, `creditsafe`, `plaid` больше не генерируют локальные mock-ответы, а работают как thin-proxy к одному upstream applicant backend.
- `core-api` теперь даёт pass-through endpoints для applicant management и provider checks.

## Новые pass-through endpoints

- `POST /api/v1/applicants`
- `GET /api/v1/applicants`
- `GET /api/v1/applicants/{id}`
- `PUT /api/v1/applicants/{id}`
- `DELETE /api/v1/applicants/{id}`
- `POST /api/v1/applicants/{id}/credit-check`
- `POST /api/v1/applicants/{id}/credit-check/isoftpull`
- `POST /api/v1/applicants/{id}/credit-check/creditsafe`
- `POST /api/v1/applicants/{id}/credit-check/plaid`
- `GET /api/v1/applicants/{id}/credit-reports`
- `GET /api/v1/credit-providers`
- `GET /api/v1/credit-providers/enabled`
- `GET /api/v1/credit-providers/available`
- `GET /api/v1/plaid/link/{trackingId}`
- `GET /api/v1/plaid/link/{trackingId}/status`

## Decisioning

Decisioning остаётся внутри платформы:

- `flowable` продолжает принимать решение по распарсенным provider reports
- `report-parser` теперь умеет читать прямые upstream payloads и статусы `FAILED`, `NO_HIT`, `PENDING_LINK`

## Важно

- Для нового или уже живого окружения нужна миграция `v11`
- В service registry должен присутствовать `credit-backend`
- Для docker-окружений connector services должны получать `CONFIG_SERVICE_URL` и `INTERNAL_API_KEY`
