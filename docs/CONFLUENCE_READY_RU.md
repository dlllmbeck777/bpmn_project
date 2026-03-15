# Confluence Package: Credit Platform v5

Ниже структура и готовый текст, который можно переносить в Confluence как:

- родительскую страницу
- набор дочерних страниц
- или одну большую операционную базу знаний

---

## Структура страниц Confluence

### Родительская страница

`Credit Platform v5`

### Рекомендуемые дочерние страницы

1. `Обзор платформы`
2. `Архитектура для руководства`
3. `Техническая архитектура`
4. `Роли и доступы`
5. `Операционные сценарии`
6. `Routing и canary`
7. `Pipeline и сервисы`
8. `Flowable UI и BPMN`
9. `Production deployment`
10. `Troubleshooting`
11. `Техническое задание`
12. `Интеграция с мобильным приложением`
13. `Интеграция с SNP`

---

## Готовый текст для страницы "Обзор платформы"

### Назначение

Credit Platform v5 предназначена для оркестрации заявок на кредитную проверку с возможностью гибкого переключения между:

- собственным runtime-оркестратором `custom`
- BPMN-движком `Flowable`

Платформа предоставляет UI для операционного управления без необходимости вручную менять конфигурацию через shell или SQL.

### Ключевые возможности

- прием заявок через API
- routing между `custom` и `flowable`
- canary rollout на Flowable
- дневной лимит на Flowable-трафик
- управление stop factors
- управление pipeline и сервисами
- request tracking
- audit log
- управление пользователями и доступами
- production deployment через Docker Compose

---

## Готовый текст для страницы "Архитектура для руководства"

Готовая версия хранится в:

- `docs/ARCHITECTURE_EXECUTIVE_RU.md`

Рекомендуется вставлять как отдельную страницу для:

- CEO / COO
- product leadership
- delivery managers
- архитектурного комитета

---

## Готовый текст для страницы "Техническая архитектура"

Готовая версия хранится в:

- `docs/ARCHITECTURE_TECHNICAL_RU.md`

Рекомендуется вставлять как отдельную страницу для:

- backend engineers
- DevOps
- техлидов
- senior analysts

---

## Готовый текст для страницы "Операционные сценарии"

### Сценарий 1. Весь auto-трафик в custom

Используется, когда нужно полностью исключить Flowable из маршрута обработки новых auto-заявок.

Действия:

1. Открыть `Scenarios`
2. Нажать `Route all auto traffic to custom`

Ожидаемый результат:

- auto-заявки идут в `custom`
- fallback rule становится `custom`

### Сценарий 2. Custom reports chain

Используется, когда в `custom` необходимо запускать только отчетные сервисы.

Действия:

1. Открыть `Scenarios`
2. Нажать `Prepare custom reports chain`

Ожидаемый результат:

- `isoftpull`
- `creditsafe`
- `plaid`

остаются в custom chain, остальные шаги для custom пропускаются.

### Сценарий 3. Flowable canary

Используется для частичного включения Flowable на доле трафика.

Поля:

- `Percent`
- `Sticky field`
- `Enabled`
- `Daily quota mode`
- `Max requests per day`

Поведение:

- при `Enabled=true` заданный процент auto-трафика идет в Flowable
- sticky field обеспечивает детерминированный выбор
- если включен `Daily quota mode`, после достижения лимита заявки начинают падать в следующий matching rule, обычно `custom`

### Сценарий 4. Полное отключение stop factors

Используется для диагностики и временного отключения блокирующей бизнес-логики.

Действия:

1. Открыть `Scenarios`
2. Нажать `Disable all stop factors`

---

## Готовый текст для страницы "Routing и canary"

### Общие принципы

Routing работает по набору правил с полями:

- `priority`
- `condition_field`
- `condition_op`
- `condition_value`
- `target_mode`
- `enabled`
- `meta`

### Meta поля canary

- `sample_percent`
- `sticky_field`
- `daily_quota_enabled`
- `daily_quota_max`

### Best practice

- типовые переключения делать через `Scenarios`
- ручную корректировку делать через `Routing rules`
- держать `custom` как fallback rule ниже canary rule
- перед повышением процента canary проверять Flowable health

---

## Готовый текст для страницы "Pipeline и сервисы"

### Pipeline

Pipeline определяет порядок вызова сервисов и поддерживает:

- enable/disable шагов
- `skip_in_custom`
- `skip_in_flowable`

### Services

Страница `Services` позволяет:

- отключать интеграции
- менять URL
- менять timeout
- менять retry count

### Практика эксплуатации

- при инциденте сначала отключать конкретный проблемный сервис, а не ломать весь маршрут
- при тестировании custom chain держать активными только нужные connectors

---

## Готовый текст для страницы "Flowable UI и BPMN"

### Роль Flowable UI

Flowable UI используется для:

- моделирования BPMN
- администрирования engine
- работы с IDM

### Production режим

Рекомендуемый режим:

- `flowable-ui` включен
- `FLOWABLE_AUTO_DEPLOY_BPMN=false`

В этом случае source of truth для BPMN в production находится в Flowable DB.

### Важно

Если меняется `processDefinitionKey`, orchestrator может перестать находить нужный процесс.

---

## Готовый текст для страницы "Production deployment"

### Быстрый запуск

```bash
DOMAIN=your-domain.com bash scripts/deploy-prod.sh
```

### Полезные скрипты

- `scripts/deploy-prod.sh`
- `scripts/reset-flowable.sh`
- `scripts/rebuild-prod.sh`

### Проверка

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod ps
curl -k https://YOUR_DOMAIN/health
```

---

## Готовый текст для страницы "Troubleshooting"

### Симптом: заявки идут в Flowable вместо custom

Проверить:

- включен ли `Auto -> Custom default`
- выключен ли canary
- не истек ли config cache
- не остался ли старый frontend bundle в браузере

### Симптом: Flowable UI не открывается

Проверить:

- `flowable-db`
- `flowable-rest`
- `flowable-ui`
- `nginx`
- пароль `FLOWABLE_DB_PASSWORD`

### Симптом: login в UI не работает

Проверить:

- `API Base URL`
- роль и api key
- сессионного пользователя в `admin_users`

---

## Готовый текст для страницы "Техническое задание"

Полный текст технического задания хранится в:

- `docs/TECH_SPECIFICATION_RU.md`

Операционная инструкция хранится в:

- `docs/OPERATIONS_RUNBOOK_RU.md`

---

## Готовый текст для страницы "Интеграция с мобильным приложением"

Полный документ хранится в:

- `docs/INTEGRATION_SPEC_MOBILE_RU.md`

Рекомендуется использовать как отдельное ТЗ для:

- mobile team
- BFF / gateway team
- интеграционной команды

---

## Готовый текст для страницы "Интеграция с SNP"

Полный документ хранится в:

- `docs/INTEGRATION_SPEC_SNP_RU.md`

Рекомендуется использовать как отдельное ТЗ для:

- команды SNP
- backend team
- интеграционной команды

---

## Рекомендация по публикации в Confluence

Лучший практический вариант:

1. Создать страницу `Credit Platform v5`
2. Вставить этот документ как skeleton
3. Вынести дочерними страницами:
   - runbook
   - ТЗ
   - deployment
   - troubleshooting
4. Закрепить ссылку на production URL, репозиторий и ответственную команду
