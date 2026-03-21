# Схема базы данных — Credit Platform v5

> Формат: Navicat Data Modeler
> СУБД: PostgreSQL 15
> База данных: `config` (порт 5433 в dev, внутри Docker — `config-db:5432`)
> Обновлено: автогенерация по `migrations.py` (миграции 1–16)

---

## Оглавление

| № | Таблица | Назначение |
|---|---------|-----------|
| 1 | [_schema_version](#1-_schema_version) | Журнал применённых миграций |
| 2 | [services](#2-services) | Реестр сервисов (коннекторы, оркестраторы, процессоры) |
| 3 | [routing_rules](#3-routing_rules) | Правила маршрутизации заявок |
| 4 | [stop_factors](#4-stop_factors) | Стоп-факторы (pre / decision) |
| 5 | [pipeline_steps](#5-pipeline_steps) | Шаги пайплайна по умолчанию |
| 6 | [audit_log](#6-audit_log) | Журнал аудита действий |
| 7 | [requests](#7-requests) | Заявки (основная сущность) |
| 8 | [snp_notifications](#8-snp_notifications) | Лог SNP-уведомлений |
| 9 | [system_state](#9-system_state) | Системное состояние (key/value) |
| 10 | [rate_limit_buckets](#10-rate_limit_buckets) | Корзины ограничения частоты запросов |
| 11 | [circuit_breakers](#11-circuit_breakers) | Состояние автоматических выключателей |
| 12 | [request_tracker_events](#12-request_tracker_events) | Детальный трекер событий заявки |
| 13 | [admin_users](#13-admin_users) | Пользователи административного UI |
| 14 | [request_notes](#14-request_notes) | Заметки оператора к заявке |
| 15 | [client_history](#15-client_history) | История поведения клиента для AI |
| 16 | [ai_usage_log](#16-ai_usage_log) | Лог использования AI (токены, стоимость) |

---

## Диаграмма связей (ERD — текстовый формат)

```
services ──< pipeline_steps
services ──< circuit_breakers

requests ──< snp_notifications
requests ──< request_tracker_events
requests ──< request_notes
requests ──< client_history (через client_key)
requests ──< ai_usage_log (через request_id)

routing_rules   (независимая таблица конфигурации)
stop_factors    (независимая таблица конфигурации)
audit_log       (независимая таблица аудита)
system_state    (независимая key/value таблица)
rate_limit_buckets (независимая таблица)
_schema_version (служебная таблица)
```

---

## 1. `_schema_version`

**Назначение:** служебная таблица для отслеживания применённых миграций. Используется `run_migrations()` при старте `core-api`.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `version` | `INTEGER` | NOT NULL | — | Номер версии миграции. Первичный ключ. |
| `applied_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата и время применения миграции. |

**Индексы:**
- `PRIMARY KEY (version)`

---

## 2. `services`

**Назначение:** реестр всех сервисов платформы — коннекторов, оркестраторов, процессоров и внешних сервисов. Используется `core-api` для:
- формирования пайплайна запросов
- healthcheck-проверок
- маршрутизации к правильному endpoint

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `TEXT` | NOT NULL | — | Уникальный строковый идентификатор сервиса (например `isoftpull`, `ai-advisor`). Первичный ключ. |
| `name` | `TEXT` | NOT NULL | — | Человекочитаемое название сервиса. |
| `type` | `TEXT` | NOT NULL | `'connector'` | Тип сервиса. Возможные значения: `connector`, `orchestrator`, `processor`, `engine`, `external`. |
| `base_url` | `TEXT` | NOT NULL | — | Базовый URL сервиса (например `http://isoftpull:8101`). |
| `health_path` | `TEXT` | NULL | `'/health'` | Путь для healthcheck-запроса (добавляется к `base_url`). |
| `enabled` | `BOOLEAN` | NULL | `TRUE` | Если `FALSE` — сервис исключается из пайплайна и маршрутизации. |
| `timeout_ms` | `INTEGER` | NULL | `10000` | Таймаут запроса к сервису в миллисекундах. |
| `retry_count` | `INTEGER` | NULL | `2` | Количество повторных попыток при ошибке. |
| `endpoint_path` | `TEXT` | NULL | `'/api/process'` | Путь к основному endpoint обработки (добавляется к `base_url`). |
| `meta` | `JSONB` | NULL | `'{}'` | Произвольные метаданные сервиса. Используется для передачи конфигурации: `model`, `owner`, `optional`, `position`. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения записи. |

**Индексы:**
- `PRIMARY KEY (id)`

**Известные значения `id`:**

| id | name | type | port |
|----|------|------|------|
| `credit-backend` | Unified Applicant Backend | external | внешний |
| `flowable-adapter` | Flowable Adapter | orchestrator | 8011 |
| `custom-adapter` | Custom Adapter | orchestrator | 8012 |
| `flowable-rest` | Flowable REST Engine | engine | 8080 |
| `isoftpull` | iSoftPull | connector | 8101 |
| `creditsafe` | Creditsafe | connector | 8102 |
| `plaid` | Plaid | connector | 8103 |
| `report-parser` | Report Parser | processor | 8105 |
| `stop-factor` | Stop Factor | processor | 8106 |
| `decision-service` | Decision Service | processor | 8107 |
| `ai-advisor` | AI Risk Advisor | processor | 8108 |
| `ai-prescreen` | AI Pre-Screen | processor | 8109 |
| `mock-bureaus` | Mock Bureaus | external | 8110 |

---

## 3. `routing_rules`

**Назначение:** таблица правил маршрутизации. Определяет, в какой оркестратор (`flowable` или `custom`) направляется заявка на основе поля запроса. Правила применяются по возрастанию `priority`.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `name` | `TEXT` | NOT NULL | — | Название правила (например `Auto -> Flowable default`). |
| `priority` | `INTEGER` | NULL | `0` | Приоритет применения. Меньшее значение = выше приоритет. |
| `condition_field` | `TEXT` | NOT NULL | — | Поле входного запроса для проверки (например `orchestration_mode`). |
| `condition_op` | `TEXT` | NOT NULL | `'eq'` | Оператор сравнения: `eq`, `neq`, `contains`, `not_in`. |
| `condition_value` | `TEXT` | NOT NULL | — | Значение для сравнения. |
| `target_mode` | `TEXT` | NOT NULL | `'flowable'` | Режим оркестрации при совпадении: `flowable`, `custom`. |
| `enabled` | `BOOLEAN` | NULL | `TRUE` | Если `FALSE` — правило игнорируется. |
| `meta` | `JSONB` | NULL | `'{}'` | Дополнительные параметры. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения. |

**Индексы:**
- `PRIMARY KEY (id)`

---

## 4. `stop_factors`

**Назначение:** правила остановки заявки на разных стадиях обработки. Применяются в двух стадиях:
- `pre` — до отправки в оркестратор (блокирующие)
- `decision` — после получения результатов бюро (итоговое решение)

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `name` | `TEXT` | NOT NULL | — | Название стоп-фактора (например `Min credit score`). |
| `stage` | `TEXT` | NOT NULL | `'pre'` | Стадия применения: `pre` или `decision`. |
| `check_type` | `TEXT` | NOT NULL | `'field_check'` | Тип проверки: `field_check` — проверка значения поля; `blacklist` — проверка по чёрному списку. |
| `field_path` | `TEXT` | NULL | — | Путь к полю в JSON-результате (например `result.parsed_report.summary.credit_score`). Используется для `field_check`. |
| `operator` | `TEXT` | NULL | `'gte'` | Оператор сравнения: `gte`, `lte`, `eq`, `neq`, `not_in`. |
| `threshold` | `TEXT` | NULL | — | Пороговое значение для сравнения (строка, сравнивается с числом или строкой). |
| `action_on_fail` | `TEXT` | NULL | `'REJECT'` | Действие при срабатывании: `REJECT` или `REVIEW`. |
| `enabled` | `BOOLEAN` | NULL | `TRUE` | Если `FALSE` — стоп-фактор не применяется. |
| `priority` | `INTEGER` | NULL | `0` | Порядок применения. Меньшее значение = выше приоритет. |
| `meta` | `JSONB` | NULL | `'{}'` | Доп. параметры. `decision_rule: true` — используется decision-service; `ai_rule: true` — AI-правило. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения. |

**Индексы:**
- `PRIMARY KEY (id)`

**Дефолтные стоп-факторы:**

| name | stage | field_path | op | threshold | action |
|------|-------|-----------|-----|-----------|--------|
| Blacklist SSN | pre | ssn | not_in | blacklist | REJECT |
| Required reports available | decision | result.parsed_report.summary.required_reports_available | eq | true | REVIEW |
| Min credit score | decision | result.parsed_report.summary.credit_score | gte | 580 | REJECT |
| Max collection count 5 | decision | result.parsed_report.summary.collection_count | lte | 5 | REJECT |
| Max Creditsafe alerts 1 | decision | result.parsed_report.summary.creditsafe_compliance_alert_count | lte | 1 | REJECT |
| AI high risk score | decision | result.ai_assessment.risk_score | gte | 80 | REVIEW |

---

## 5. `pipeline_steps`

**Назначение:** упорядоченный список шагов пайплайна для режима `custom`. Каждый шаг — вызов сервиса из таблицы `services`. Шаги выполняются в порядке возрастания `step_order`.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `pipeline_name` | `TEXT` | NOT NULL | `'default'` | Имя пайплайна. В текущей версии используется только `default`. |
| `step_order` | `INTEGER` | NOT NULL | — | Порядковый номер шага (1, 2, 3...). |
| `service_id` | `TEXT` | NOT NULL | — | Ссылка на `services.id`. При удалении сервиса — каскадное удаление шага. |
| `enabled` | `BOOLEAN` | NULL | `TRUE` | Если `FALSE` — шаг пропускается. |
| `meta` | `JSONB` | NULL | `'{}'` | Доп. настройки шага: `skip_in_flowable: true` — шаг пропускается в режиме Flowable; `optional: true` — ошибка шага не прерывает пайплайн. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения. |

**Индексы:**
- `PRIMARY KEY (id)`

**Внешние ключи:**
- `service_id → services(id) ON DELETE CASCADE`

**Дефолтный пайплайн (`pipeline_name = 'default'`):**

| step_order | service_id | meta |
|-----------|-----------|------|
| 1 | isoftpull | `{}` |
| 2 | creditsafe | `{}` |
| 3 | plaid | `{"skip_in_flowable": true}` |
| 4 | ai-advisor | `{"optional": true}` |

---

## 6. `audit_log`

**Назначение:** полный журнал аудита всех операций с сущностями системы. Хранится 365 дней (data retention worker).

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `entity_type` | `TEXT` | NULL | — | Тип сущности: `request`, `service`, `stop_factor`, `user` и т.д. |
| `entity_id` | `TEXT` | NULL | — | Идентификатор сущности (строка). |
| `action` | `TEXT` | NULL | — | Действие: `created`, `updated`, `deleted`, `note_added`, `ignored`, `retried` и т.д. |
| `changes` | `JSONB` | NULL | — | JSON-дифф изменений `{field: [old, new]}` или произвольные данные. |
| `performed_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время действия. |
| `performed_by` | `TEXT` | NULL | — | Имя пользователя или идентификатор API-ключа, выполнившего действие. Добавлено в миграции 8. |

**Индексы:**
- `PRIMARY KEY (id)`

---

## 7. `requests`

**Назначение:** основная таблица заявок. Является центральной сущностью всего платформы. Хранит полный жизненный цикл заявки — от поступления до финального решения.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Внутренний числовой первичный ключ. |
| `request_id` | `TEXT` | NOT NULL | — | Уникальный UUID заявки. Используется во всех внешних и внутренних ссылках. UNIQUE. |
| `customer_id` | `TEXT` | NULL | — | Внешний идентификатор клиента, переданный при создании заявки. |
| `iin_encrypted` | `TEXT` | NULL | — | ИИН (БИН/ИНН) клиента, зашифрованный Fernet (`ENC2:...`). |
| `ssn_encrypted` | `TEXT` | NULL | — | SSN клиента, зашифрованный Fernet. Добавлено в миграции 9. |
| `applicant_profile` | `JSONB` | NULL | `'{}'` | Полный профиль заявителя в формате JSON. Содержит все поля анкеты. Добавлено в миграции 9. |
| `external_applicant_id` | `TEXT` | NULL | — | Внешний ID заявителя (из Unified Applicant Backend). Добавлено в миграции 11. |
| `product_type` | `TEXT` | NULL | — | Тип продукта кредитования (например `personal`, `auto`, `mortgage`). |
| `orchestration_mode` | `TEXT` | NULL | — | Режим оркестрации: `flowable`, `custom`, `auto`, `deduplicated`. |
| `status` | `TEXT` | NULL | `'SUBMITTED'` | Текущий статус заявки. Подробнее — см. ниже. |
| `result` | `JSONB` | NULL | — | Итоговый результат обработки в JSON. Структура зависит от mode. |
| `post_stop_factor` | `JSONB` | NULL | — | Результат применения POST стоп-факторов (`decision`: `PASS`/`REJECT`/`REVIEW`, детали). |
| `snp_result` | `JSONB` | NULL | — | Результат SNP-уведомления: `forwarded`, `target`, код ответа. |
| `error` | `TEXT` | NULL | — | Текст ошибки при неуспешной обработке. |
| `correlation_id` | `TEXT` | NULL | — | UUID сессии обработки. Используется для трейсинга через все сервисы. |
| `ignored` | `BOOLEAN` | NOT NULL | `FALSE` | Заявка помечена как проигнорированная оператором. Добавлено в миграции 10. |
| `ignored_reason` | `TEXT` | NULL | — | Причина игнорирования. |
| `ignored_at` | `TIMESTAMPTZ` | NULL | — | Дата игнорирования. |
| `ignored_by` | `TEXT` | NULL | — | Кто проигнорировал (имя пользователя). |
| `persisted_at` | `TIMESTAMPTZ` | NULL | — | Время первичной записи (write-first persistence). Добавлено в миграции 15. |
| `recovery_attempts` | `INTEGER` | NOT NULL | `0` | Количество попыток восстановления зависшей заявки. Добавлено в миграции 15. |
| `last_recovery_at` | `TIMESTAMPTZ` | NULL | — | Время последней попытки восстановления. Добавлено в миграции 15. |
| `idempotency_key` | `TEXT` | NULL | — | Ключ идемпотентности от клиента. UNIQUE (partial index). Добавлено в миграции 16. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время создания заявки. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время последнего обновления. |

**Индексы:**
- `PRIMARY KEY (id)`
- `UNIQUE (request_id)` — все внешние ссылки идут через `request_id`
- `idx_requests_status ON requests(status)` — фильтрация по статусу
- `idx_requests_created ON requests(created_at DESC)` — сортировка по дате
- `idx_requests_external_applicant_id ON requests(external_applicant_id)` — поиск по внешнему ID
- `idx_requests_status_created ON requests(status, created_at)` — для reconcile worker
- `idx_requests_idempotency_key ON requests(idempotency_key) WHERE idempotency_key IS NOT NULL` — partial unique index

**Жизненный цикл статусов:**

```
                    ┌──────────────────────────────────────────┐
                    │           PERSISTED (write-first)         │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │        APPLICANT_CREATING                  │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │        APPLICANT_CREATED                   │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │        ENGINE_SUBMITTING                   │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │           RUNNING / SUBMITTED              │
                    └──────┬───────────────────┬───────────────┘
                           │                   │
              ┌────────────▼───┐      ┌────────▼───────────┐
              │  ENGINE_ERROR  │      │    COMPLETED        │
              │ENGINE_UNREACHABLE     │    REVIEW           │
              └────────────────┘      │    REJECTED         │
                                      │    FAILED           │
                                      └────────────────────-┘
                                          (TERMINAL)

Параллельно: зависшие в промежуточных статусах → RECOVERY_PENDING (reconcile worker)
```

| Статус | Описание |
|--------|---------|
| `PERSISTED` | Заявка записана в БД, обработка ещё не началась |
| `APPLICANT_CREATING` | Создание заявителя во внешней системе |
| `APPLICANT_CREATED` | Заявитель создан, готово к отправке в движок |
| `ENGINE_SUBMITTING` | Отправка в оркестратор/движок |
| `SUBMITTED` | Отправлена в движок, ожидаем callback |
| `RUNNING` | Движок выполняет обработку |
| `COMPLETED` | Успешно завершена (TERMINAL) |
| `REVIEW` | Требует ручной проверки (TERMINAL) |
| `REJECTED` | Отклонена стоп-фактором или решением движка (TERMINAL) |
| `FAILED` | Техническая ошибка (TERMINAL) |
| `ENGINE_ERROR` | Ошибка движка |
| `ENGINE_UNREACHABLE` | Движок недоступен |
| `RECOVERY_PENDING` | Помечена reconcile worker как требующая восстановления |

---

## 8. `snp_notifications`

**Назначение:** лог отправки SNP (Subject Notification Platform) уведомлений по завершении заявки. Хранится 90 дней.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `request_id` | `TEXT` | NULL | — | Идентификатор заявки. Мягкая ссылка (без FK). |
| `snp_target` | `TEXT` | NULL | — | URL-адрес, на который отправлено уведомление. `NOT_CONFIGURED` если SNP не настроен. |
| `forwarded` | `BOOLEAN` | NULL | `FALSE` | `TRUE` если уведомление успешно отправлено (HTTP 2xx). |
| `response_code` | `INTEGER` | NULL | — | HTTP-код ответа от SNP-сервера. |
| `error` | `TEXT` | NULL | — | Текст ошибки при сбое отправки. |
| `sent_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время попытки отправки. |

**Индексы:**
- `PRIMARY KEY (id)`

---

## 9. `system_state`

**Назначение:** хранилище системных ключ-значение состояний платформы. Используется для:
- `config_version` — версия конфигурации (инвалидация кэша)
- `seed_completed` — флаг первоначальной инициализации данных

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `key` | `TEXT` | NOT NULL | — | Уникальное имя ключа. Первичный ключ. |
| `value_text` | `TEXT` | NOT NULL | `'0'` | Значение в текстовом формате. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения. |

**Индексы:**
- `PRIMARY KEY (key)`

**Известные ключи:**

| key | Описание |
|-----|---------|
| `config_version` | Монотонно растущий счётчик. При изменении конфигурации сервисов инкрементируется, что инвалидирует кэш в сервисах. |
| `seed_completed` | `'true'` после первого успешного seed. Защищает от перезаписи оператором. |

---

## 10. `rate_limit_buckets`

**Назначение:** скользящее окно для ограничения частоты запросов (rate limiting). Хранит число попаданий в временной корзине для каждого ключа. Очищается data retention worker каждые 2 часа.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `bucket_key` | `TEXT` | NOT NULL | — | Ключ ограничения: комбинация IP + endpoint или API-ключа. Часть составного PK. |
| `window_start` | `BIGINT` | NOT NULL | — | Unix timestamp начала окна (в секундах). Часть составного PK. |
| `hits` | `INTEGER` | NOT NULL | `0` | Число запросов в данном окне. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время последнего обновления. |

**Индексы:**
- `PRIMARY KEY (bucket_key, window_start)`

---

## 11. `circuit_breakers`

**Назначение:** состояние автоматических выключателей для каждого сервиса. Реализует паттерн Circuit Breaker: при серии ошибок сервис переходит в состояние `OPEN` и временно не вызывается.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `service_id` | `TEXT` | NOT NULL | — | Идентификатор сервиса (соответствует `services.id`). Первичный ключ. |
| `state` | `TEXT` | NOT NULL | `'CLOSED'` | Состояние: `CLOSED` (работает), `OPEN` (заблокирован), `HALF_OPEN` (тестирование). |
| `opened_at_epoch` | `DOUBLE PRECISION` | NOT NULL | `0` | Unix timestamp открытия выключателя. `0` если выключатель закрыт. |
| `failures_json` | `JSONB` | NOT NULL | `'[]'` | JSON-массив временных меток последних неудач (epoch float). |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время последнего изменения. |

**Индексы:**
- `PRIMARY KEY (service_id)`

---

## 12. `request_tracker_events`

**Назначение:** детальный лог событий каждой заявки. Хранит все переходы статусов, вызовы сервисов, результаты стоп-факторов, SNP-уведомления. Используется для отладки и аудита. Хранится 90 дней.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `request_id` | `TEXT` | NOT NULL | — | Идентификатор заявки. |
| `stage` | `TEXT` | NOT NULL | — | Стадия события: `request`, `stop_factor_pre`, `stop_factor_post`, `pipeline_step`, `orchestrator`, `snp`, `ai_prescreen`, `ai_advisor`. |
| `service_id` | `TEXT` | NULL | — | Идентификатор сервиса, если событие связано с конкретным сервисом. |
| `direction` | `TEXT` | NOT NULL | — | Направление: `REQUEST` (исходящий вызов), `RESPONSE` (ответ), `STATE` (изменение состояния), `ERROR`. |
| `status` | `TEXT` | NULL | — | Статус события: HTTP-код, `PASS`, `REJECT`, `REVIEW`, `ok`, `error` и т.д. |
| `title` | `TEXT` | NOT NULL | — | Краткое описание события (например `iSoftPull response received`). |
| `payload` | `JSONB` | NULL | `'{}'` | Тело запроса или ответа. PII-поля маскируются через `tracker_payload()`. |
| `correlation_id` | `TEXT` | NULL | — | UUID сессии для корреляции событий одной заявки. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время события. |

**Индексы:**
- `PRIMARY KEY (id)`
- `idx_request_tracker_request_id ON request_tracker_events(request_id, id DESC)` — выборка событий по заявке в обратном порядке
- `idx_request_tracker_created_at ON request_tracker_events(created_at DESC)` — глобальная сортировка

---

## 13. `admin_users`

**Назначение:** пользователи административного UI. Поддерживает три роли: `admin`, `senior_analyst`, `analyst`. Хранит сессионные токены для UI-авторизации.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `username` | `TEXT` | NOT NULL | — | Логин пользователя. Первичный ключ. |
| `display_name` | `TEXT` | NULL | — | Отображаемое имя (ФИО или псевдоним). |
| `role` | `TEXT` | NOT NULL | `'analyst'` | Роль: `admin`, `senior_analyst`, `analyst`. |
| `password_hash` | `TEXT` | NOT NULL | — | Bcrypt-хэш пароля. |
| `enabled` | `BOOLEAN` | NOT NULL | `TRUE` | Если `FALSE` — пользователь заблокирован. |
| `source` | `TEXT` | NOT NULL | `'db'` | Источник создания: `db` (ручное), `env` (из переменных окружения). |
| `session_token` | `TEXT` | NULL | — | Токен текущей сессии (UUID). NULL если не авторизован. |
| `session_issued_at` | `TIMESTAMPTZ` | NULL | — | Время выдачи токена. |
| `session_expires_at` | `TIMESTAMPTZ` | NULL | — | Время истечения токена. Добавлено в миграции 7. |
| `last_login_at` | `TIMESTAMPTZ` | NULL | — | Время последнего входа. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата создания пользователя. |
| `updated_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Дата последнего изменения. |

**Индексы:**
- `PRIMARY KEY (username)`
- `idx_admin_users_role ON admin_users(role)`
- `idx_admin_users_enabled ON admin_users(enabled)`

**Права доступа по ролям:**

| Роль | Просмотр заявок | Управление конфигурацией | Управление пользователями | Удаление заявок |
|------|----------------|------------------------|--------------------------|----------------|
| `analyst` | ✓ | ✗ | ✗ | ✗ |
| `senior_analyst` | ✓ | ✓ (ограниченно) | ✗ | ✗ |
| `admin` | ✓ | ✓ | ✓ | ✓ |

---

## 14. `request_notes`

**Назначение:** заметки оператора к конкретной заявке. Используется для документирования ручных решений, коммуникации между операторами.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `request_id` | `TEXT` | NOT NULL | — | Ссылка на `requests(request_id)`. Каскадное удаление. |
| `note_text` | `TEXT` | NOT NULL | — | Текст заметки. |
| `created_by` | `TEXT` | NULL | — | Имя пользователя, создавшего заметку. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время создания. |

**Индексы:**
- `PRIMARY KEY (id)`
- `idx_request_notes_request_id ON request_notes(request_id, id DESC)`

**Внешние ключи:**
- `request_id → requests(request_id) ON DELETE CASCADE`

---

## 15. `client_history`

**Назначение:** история поведения клиента для AI Pre-Screen сервиса. Хранит агрегированные данные по предыдущим заявкам клиента для построения контекста при следующих обращениях.

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `client_key` | `TEXT` | NOT NULL | — | Анонимизированный ключ клиента (хэш от SSN/ИИН). |
| `request_id` | `TEXT` | NOT NULL | — | Идентификатор заявки, сгенерировавшей эту запись. |
| `event_type` | `TEXT` | NOT NULL | `'APPLICATION'` | Тип события: `APPLICATION`. |
| `credit_score` | `INTEGER` | NULL | — | Кредитный скор на момент подачи заявки. |
| `collection_count` | `INTEGER` | NULL | — | Количество коллекций. |
| `decision` | `TEXT` | NULL | — | Итоговое решение: `COMPLETED`, `REJECTED`, `REVIEW` и т.д. |
| `decision_reason` | `TEXT` | NULL | — | Причина принятия решения. |
| `decision_source` | `TEXT` | NULL | — | Источник решения: `stop_factor`, `engine`, `ai`. |
| `ai_risk_score` | `INTEGER` | NULL | — | AI-оценка риска (0–100). |
| `ai_recommendation` | `TEXT` | NULL | — | Рекомендация AI: `APPROVE`, `REVIEW`, `REJECT`. |
| `product_type` | `TEXT` | NULL | — | Тип продукта. |
| `city` | `TEXT` | NULL | — | Город заявителя. |
| `state` | `TEXT` | NULL | — | Штат/регион заявителя. |
| `route_mode` | `TEXT` | NULL | — | Режим маршрутизации, использованный для заявки. |
| `processing_time_ms` | `INTEGER` | NULL | — | Время обработки заявки в миллисекундах. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время создания записи. |

**Индексы:**
- `PRIMARY KEY (id)`
- `idx_client_history_key ON client_history(client_key, created_at DESC)` — история клиента в обратном хронологическом порядке
- `idx_client_history_created ON client_history(created_at DESC)` — глобальная сортировка

---

## 16. `ai_usage_log`

**Назначение:** детальный лог использования AI-сервисов (токены, стоимость, статус). Используется для:
- биллинга и контроля затрат
- аналитики по использованию моделей
- мониторинга ошибок AI

| Колонка | Тип | NULL | По умолч. | Описание |
|---------|-----|------|-----------|---------|
| `id` | `SERIAL` | NOT NULL | автоинкремент | Первичный ключ. |
| `request_id` | `TEXT` | NULL | — | Идентификатор заявки. NULL если вызов не привязан к конкретной заявке. |
| `service_id` | `TEXT` | NOT NULL | — | Идентификатор AI-сервиса: `ai-advisor`, `ai-prescreen`. |
| `model` | `TEXT` | NOT NULL | `'gpt-4o-mini'` | Модель AI (например `gpt-4o-mini`, `gpt-4o`). |
| `prompt_tokens` | `INTEGER` | NULL | `0` | Количество токенов в промпте (входные токены). |
| `completion_tokens` | `INTEGER` | NULL | `0` | Количество токенов в ответе (выходные токены). |
| `total_tokens` | `INTEGER` | NULL | `0` | Общее число токенов = `prompt_tokens + completion_tokens`. |
| `cost_usd` | `NUMERIC(10,6)` | NULL | `0` | Стоимость вызова в долларах США. |
| `status` | `TEXT` | NULL | `'ok'` | Статус вызова: `ok`, `error`, `fallback`. |
| `error_code` | `TEXT` | NULL | — | Код ошибки OpenAI API при сбое. |
| `created_at` | `TIMESTAMPTZ` | NULL | `NOW()` | Время вызова. |

**Индексы:**
- `PRIMARY KEY (id)`
- `idx_ai_usage_service_ts ON ai_usage_log(service_id, created_at DESC)` — статистика по сервису
- `idx_ai_usage_ts ON ai_usage_log(created_at DESC)` — глобальная хронология

---

## Политика хранения данных (Data Retention)

| Таблица | Срок хранения | Условие очистки |
|---------|-------------|----------------|
| `request_tracker_events` | 90 дней | `created_at < NOW() - INTERVAL '90 days'` |
| `snp_notifications` | 90 дней | `sent_at < NOW() - INTERVAL '90 days'` |
| `audit_log` | 365 дней | `performed_at < NOW() - INTERVAL '365 days'` |
| `rate_limit_buckets` | 2 часа | `window_start < NOW() - 7200 sec` |
| `requests` | без ограничения | — |
| `client_history` | без ограничения | — |
| `ai_usage_log` | без ограничения | — |

Очистка выполняется фоновым воркером `_data_retention_worker()` каждые 6 часов.

---

## Шифрование чувствительных данных

Поля `iin_encrypted` и `ssn_encrypted` в таблице `requests` хранятся в зашифрованном виде:

| Формат | Алгоритм | Описание |
|--------|---------|---------|
| `ENC2:<base64>` | Fernet (AES-128-CBC + HMAC-SHA256) | Текущий формат |
| `ENC:<xor_hex>` | XOR (legacy) | Устаревший формат, автоматически мигрируется при старте |

Ключ шифрования: переменная окружения `ENCRYPT_KEY` (32+ символов).

---

## Маскирование PII в трекере

`tracker_payload()` в `storage.py` автоматически маскирует значения по ключевым словам в именах полей:

**Точное совпадение:** `iin`, `iin_encrypted`, `ssn`, `ssn_encrypted`, `dateofbirth`, `firstname`, `lastname`, `address`, `zipcode`, `email`, `phone`, `api_key`, `internal_api_key`, `password`, `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-internal-api-key`, `token`, `access_token`, `refresh_token`, `secret`

**Подстрока в имени поля:** `iin`, `ssn`, `password`, `api_key`, `email`, `phone`, `token`, `secret`, `authorization`, `cookie`

Маскирование: последние 4 символа + `***` префикс (например `***7890`).

---

## Типовые запросы

### Заявки в процессе обработки

```sql
SELECT request_id, status, created_at, updated_at
FROM requests
WHERE status NOT IN ('COMPLETED','REVIEW','REJECTED','FAILED')
ORDER BY created_at DESC;
```

### Зависшие заявки (кандидаты для recovery)

```sql
SELECT request_id, status, updated_at, recovery_attempts
FROM requests
WHERE status IN ('PERSISTED','APPLICANT_CREATING','ENGINE_SUBMITTING')
  AND updated_at < NOW() - (30 * INTERVAL '1 minute')
ORDER BY updated_at;
```

### Последние события по заявке

```sql
SELECT id, stage, direction, title, status, created_at
FROM request_tracker_events
WHERE request_id = '<request_id>'
ORDER BY id DESC
LIMIT 50;
```

### AI-расходы за последние 7 дней

```sql
SELECT service_id, model,
       SUM(total_tokens) AS total_tokens,
       SUM(cost_usd) AS total_cost_usd,
       COUNT(*) AS calls
FROM ai_usage_log
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY service_id, model
ORDER BY total_cost_usd DESC;
```

### Дедупликация по idempotency_key

```sql
SELECT request_id, status, idempotency_key, created_at
FROM requests
WHERE idempotency_key = '<client_request_id>';
```

### Статистика по статусам за сегодня

```sql
SELECT status, COUNT(*) AS cnt
FROM requests
WHERE created_at >= CURRENT_DATE
GROUP BY status
ORDER BY cnt DESC;
```
