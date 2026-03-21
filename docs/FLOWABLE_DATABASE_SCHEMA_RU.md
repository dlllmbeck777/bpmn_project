# Схема базы данных Flowable 6.8.0

> СУБД: PostgreSQL 15
> База данных: `flowable` (порт 5434 в dev, внутри Docker — `flowable-db:5432`)
> Версия движка: Flowable 6.8.0
> Схема создаётся автоматически Flowable при первом запуске

---

## Оглавление

Таблицы Flowable разбиты на **префиксные группы**:

| Префикс | Группа | Назначение |
|---------|--------|-----------|
| `ACT_GE_` | General | Общие данные: бинарные объекты, свойства движка |
| `ACT_RE_` | Repository | Репозиторий: деплойменты, определения процессов, модели |
| `ACT_RU_` | Runtime | Рантайм: активные экземпляры, задачи, переменные, джобы |
| `ACT_HI_` | History | История завершённых экземпляров, задач, активностей |
| `ACT_ID_` | Identity | Пользователи и группы (IDM) |
| `ACT_EVT_` | Event Log | Лог событий движка |
| `ACT_PROCDEF_` | Process Def | Дополнительные данные определений процессов |
| `FLW_` | Flowable | Flowable-specific: каналы, event registry, case (CMMN) |

---

## Группа ACT_GE — General (Общие)

### `ACT_GE_BYTEARRAY`

**Назначение:** хранилище бинарных объектов. Содержит XML BPMN-файлы, PNG-диаграммы, сериализованные переменные. Центральная таблица для всех бинарных данных движка.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Версия записи (оптимистическая блокировка). |
| `NAME_` | VARCHAR(255) | Имя файла или описание (например `my-process.bpmn20.xml`). |
| `DEPLOYMENT_ID_` | VARCHAR(64) | Ссылка на `ACT_RE_DEPLOYMENT.ID_`. |
| `BYTES_` | BYTEA | Бинарное содержимое (BPMN XML, PNG, сериализованный объект). |
| `GENERATED_` | BOOLEAN | `TRUE` если объект сгенерирован автоматически (PNG-диаграмма). |

**Индексы:**
- `PRIMARY KEY (ID_)`
- FK → `ACT_RE_DEPLOYMENT(ID_)`

---

### `ACT_GE_PROPERTY`

**Назначение:** системные свойства движка. Хранит версию схемы, идентификатор движка, счётчики.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `NAME_` | VARCHAR(64) | Первичный ключ. Имя свойства. |
| `VALUE_` | VARCHAR(300) | Значение. |
| `REV_` | INTEGER | Версия записи. |

**Известные ключи:**

| NAME_ | Описание |
|-------|---------|
| `schema.version` | Версия схемы Flowable (например `6.8.0.0`). |
| `schema.history` | История миграций схемы. |
| `next.dbid` | Следующий числовой идентификатор (блок-аллокатор ID). |

---

## Группа ACT_RE — Repository (Репозиторий)

### `ACT_RE_DEPLOYMENT`

**Назначение:** деплойменты процессов. Каждый деплоймент — набор файлов (BPMN, DMN, форм), загруженных за один раз.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `NAME_` | VARCHAR(255) | Имя деплоймента (например `Credit Scoring Process`). |
| `CATEGORY_` | VARCHAR(255) | Категория (произвольная строка для классификации). |
| `KEY_` | VARCHAR(255) | Ключ деплоймента. |
| `TENANT_ID_` | VARCHAR(255) | Идентификатор тенанта (multi-tenant). Пусто при одиночном режиме. |
| `DEPLOY_TIME_` | TIMESTAMP | Время деплоя. |
| `DERIVED_FROM_` | VARCHAR(64) | Ссылка на исходный деплоймент при дублировании. |
| `DERIVED_FROM_ROOT_` | VARCHAR(64) | Ссылка на корневой деплоймент. |
| `PARENT_DEPLOYMENT_ID_` | VARCHAR(255) | Родительский деплоймент (для версионирования). |
| `ENGINE_VERSION_` | VARCHAR(255) | Версия Flowable, создавшая деплоймент. |

**В нашей платформе:** при старте оркестраторов автодеплой BPMN-файлов из `/processes` создаёт новую запись здесь. Управляется `FLOWABLE_AUTO_DEPLOY_BPMN=true/false`.

---

### `ACT_RE_PROCDEF`

**Назначение:** определения процессов (BPMN). Каждая версия каждого процесса — отдельная строка. Движок оставляет все версии для совместимости с уже запущенными экземплярами.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ (`key:version:tenant`). |
| `REV_` | INTEGER | Ревизия записи. |
| `CATEGORY_` | VARCHAR(255) | Пространство имён из BPMN XML (`targetNamespace`). |
| `NAME_` | VARCHAR(255) | Имя процесса из BPMN (`name` атрибут). |
| `KEY_` | VARCHAR(255) | Ключ процесса (`id` в BPMN). Используется при запуске. |
| `VERSION_` | INTEGER | Автоинкрементная версия. При каждом реплойменте увеличивается. |
| `DEPLOYMENT_ID_` | VARCHAR(64) | Ссылка на `ACT_RE_DEPLOYMENT.ID_`. |
| `RESOURCE_NAME_` | VARCHAR(4000) | Путь к BPMN-файлу внутри деплоя. |
| `DGRM_RESOURCE_NAME_` | VARCHAR(4000) | Путь к PNG-диаграмме (если сгенерирована). |
| `DESCRIPTION_` | VARCHAR(4000) | Описание процесса. |
| `HAS_START_FORM_KEY_` | BOOLEAN | Есть ли форма на стартовом событии. |
| `HAS_GRAPHICAL_NOTATION_` | BOOLEAN | Есть ли BPMNDI-разметка для визуализации. |
| `SUSPENSION_STATE_` | INTEGER | `1` — активен, `2` — приостановлен. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |
| `ENGINE_VERSION_` | VARCHAR(255) | Версия движка. |
| `DERIVED_FROM_` | VARCHAR(64) | Ссылка на процесс, от которого произошёл. |
| `DERIVED_FROM_ROOT_` | VARCHAR(64) | Корневой источник. |
| `DERIVED_VERSION_` | INTEGER | Версия производного процесса. |

**Важно:** `KEY_` — это `processDefinitionKey` в API. Используется при запуске процесса: `POST /flowable-rest/service/runtime/process-instances`.

---

### `ACT_RE_MODEL`

**Назначение:** модели процессов, созданные в Flowable Modeler UI. Хранит JSON-представление и XML для визуального редактора.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `NAME_` | VARCHAR(255) | Имя модели. |
| `KEY_` | VARCHAR(255) | Ключ модели. |
| `CATEGORY_` | VARCHAR(255) | Категория. |
| `CREATE_TIME_` | TIMESTAMP | Время создания. |
| `LAST_UPDATE_TIME_` | TIMESTAMP | Время последнего изменения. |
| `VERSION_` | INTEGER | Версия. |
| `META_INFO_` | VARCHAR(4000) | JSON с метаданными модели. |
| `DEPLOYMENT_ID_` | VARCHAR(64) | Ссылка на деплоймент (если задеплоена). |
| `EDITOR_SOURCE_VALUE_ID_` | VARCHAR(64) | Ссылка на `ACT_GE_BYTEARRAY` — JSON редактора. |
| `EDITOR_SOURCE_EXTRA_VALUE_ID_` | VARCHAR(64) | Ссылка на `ACT_GE_BYTEARRAY` — PNG-превью. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

## Группа ACT_RU — Runtime (Рантайм)

> **Эти таблицы содержат только активные (не завершённые) экземпляры.** После завершения процесса данные переносятся в `ACT_HI_*` и удаляются отсюда.

### `ACT_RU_EXECUTION`

**Назначение:** активные экземпляры процессов и их ветки выполнения. Каждый экземпляр процесса имеет минимум одну запись (корневую), плюс дополнительные для параллельных веток.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ (execution ID). |
| `REV_` | INTEGER | Ревизия (оптимистическая блокировка). |
| `PROC_INST_ID_` | VARCHAR(64) | ID корневого экземпляра процесса. Для корня совпадает с `ID_`. |
| `BUSINESS_KEY_` | VARCHAR(255) | Бизнес-ключ экземпляра. В нашей платформе — `request_id`. |
| `PARENT_ID_` | VARCHAR(64) | Родительский execution (для параллельных веток). |
| `PROC_DEF_ID_` | VARCHAR(64) | Ссылка на `ACT_RE_PROCDEF.ID_`. |
| `SUPER_EXEC_` | VARCHAR(64) | Ссылка на родительский экземпляр (для call activity). |
| `ROOT_PROC_INST_ID_` | VARCHAR(64) | Корневой процесс в иерархии. |
| `ACT_ID_` | VARCHAR(255) | Текущий activity ID в BPMN (где находится токен). |
| `IS_ACTIVE_` | BOOLEAN | `TRUE` если execution активен. |
| `IS_CONCURRENT_` | BOOLEAN | `TRUE` если параллельная ветка. |
| `IS_SCOPE_` | BOOLEAN | `TRUE` если это scope (subprocess, call activity). |
| `IS_EVENT_SCOPE_` | BOOLEAN | `TRUE` если это event scope. |
| `IS_MI_ROOT_` | BOOLEAN | `TRUE` если это Multi-Instance root. |
| `SUSPENSION_STATE_` | INTEGER | `1` — активен, `2` — приостановлен. |
| `CACHED_ENT_STATE_` | INTEGER | Внутренний кэш состояния. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |
| `NAME_` | VARCHAR(255) | Имя экземпляра. |
| `START_ACT_ID_` | VARCHAR(255) | ID стартового события. |
| `START_TIME_` | TIMESTAMP | Время запуска. |
| `START_USER_ID_` | VARCHAR(255) | Пользователь, запустивший процесс. |
| `LOCK_TIME_` | TIMESTAMP | Время захвата блокировки (async job executor). |
| `LOCK_OWNER_` | VARCHAR(255) | UUID воркера, захватившего блокировку. |
| `IS_COUNT_ENABLED_` | BOOLEAN | Включён ли счётчик дочерних сущностей. |
| `EVT_SUBSCR_COUNT_` | INTEGER | Количество event subscriptions. |
| `TASK_COUNT_` | INTEGER | Количество задач. |
| `JOB_COUNT_` | INTEGER | Количество джобов. |
| `TIMER_JOB_COUNT_` | INTEGER | Количество таймерных джобов. |
| `SUSP_JOB_COUNT_` | INTEGER | Количество suspended джобов. |
| `DEADLETTER_JOB_COUNT_` | INTEGER | Количество dead-letter джобов. |
| `EXTERNAL_WORKER_JOB_COUNT_` | INTEGER | Количество external worker джобов. |
| `VAR_COUNT_` | INTEGER | Количество переменных. |
| `ID_LINK_COUNT_` | INTEGER | Количество identity links. |
| `CALLBACK_ID_` | VARCHAR(255) | ID callback (для external процессов). |
| `CALLBACK_TYPE_` | VARCHAR(255) | Тип callback. |
| `REFERENCE_ID_` | VARCHAR(255) | Внешний ссылочный ID. |
| `REFERENCE_TYPE_` | VARCHAR(255) | Тип внешней ссылки. |
| `PROPAGATED_STAGE_INST_ID_` | VARCHAR(255) | ID стадии CMMN (при интеграции). |

**Ключевые запросы:**
```sql
-- Найти активный процесс по request_id
SELECT * FROM ACT_RU_EXECUTION
WHERE BUSINESS_KEY_ = '<request_id>' AND PARENT_ID_ IS NULL;
```

---

### `ACT_RU_TASK`

**Назначение:** активные пользовательские задачи (User Tasks). Содержит задачи, ожидающие выполнения человеком в Flowable UI.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ (task ID). |
| `REV_` | INTEGER | Ревизия. |
| `EXECUTION_ID_` | VARCHAR(64) | Ссылка на `ACT_RU_EXECUTION`. |
| `PROC_INST_ID_` | VARCHAR(64) | ID экземпляра процесса. |
| `PROC_DEF_ID_` | VARCHAR(64) | Ссылка на определение процесса. |
| `TASK_DEF_ID_` | VARCHAR(64) | ID task definition (в BPMN). |
| `SCOPE_ID_` | VARCHAR(255) | Scope (CMMN). |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `NAME_` | VARCHAR(255) | Имя задачи (из BPMN `name`). |
| `PARENT_TASK_ID_` | VARCHAR(64) | Родительская задача (для subtask). |
| `DESCRIPTION_` | VARCHAR(4000) | Описание задачи. |
| `TASK_DEF_KEY_` | VARCHAR(255) | Ключ task definition из BPMN. |
| `OWNER_` | VARCHAR(255) | Владелец задачи. |
| `ASSIGNEE_` | VARCHAR(255) | Исполнитель (назначенный). |
| `DELEGATION_` | VARCHAR(64) | Статус делегирования: `PENDING`, `RESOLVED`. |
| `PRIORITY_` | INTEGER | Приоритет (по умолчанию 50). |
| `CREATE_TIME_` | TIMESTAMP | Время создания. |
| `DUE_DATE_` | TIMESTAMP | Крайний срок выполнения. |
| `CATEGORY_` | VARCHAR(255) | Категория задачи. |
| `SUSPENSION_STATE_` | INTEGER | Статус приостановки. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |
| `FORM_KEY_` | VARCHAR(255) | Ключ формы для задачи. |
| `CLAIM_TIME_` | TIMESTAMP | Время захвата задачи (`claim`). |
| `IS_COUNT_ENABLED_` | BOOLEAN | Счётчик подзадач. |
| `VAR_COUNT_` | INTEGER | Количество переменных. |
| `ID_LINK_COUNT_` | INTEGER | Количество identity links. |
| `SUB_TASK_COUNT_` | INTEGER | Количество подзадач. |

---

### `ACT_RU_VARIABLE`

**Назначение:** переменные активных процессов. Хранит все переменные (входные данные, промежуточные результаты, решения) для выполняющихся экземпляров.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `TYPE_` | VARCHAR(255) | Тип переменной: `string`, `integer`, `boolean`, `json`, `serializable`, `null`, `bytes` и т.д. |
| `NAME_` | VARCHAR(255) | Имя переменной. |
| `EXECUTION_ID_` | VARCHAR(64) | Ссылка на execution. |
| `PROC_INST_ID_` | VARCHAR(64) | ID экземпляра процесса. |
| `TASK_ID_` | VARCHAR(64) | ID задачи (если переменная task-local). |
| `SCOPE_ID_` | VARCHAR(255) | Scope (CMMN). |
| `SUB_SCOPE_ID_` | VARCHAR(255) | Sub-scope. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `BYTEARRAY_ID_` | VARCHAR(64) | Ссылка на `ACT_GE_BYTEARRAY` для бинарных/json значений. |
| `DOUBLE_` | DOUBLE PRECISION | Значение для типа `double`. |
| `LONG_` | BIGINT | Значение для типов `integer`, `long`, `date`. |
| `TEXT_` | VARCHAR(4000) | Значение для типа `string`, `uuid`, ключевые значения `json`. |
| `TEXT2_` | VARCHAR(4000) | Вспомогательное текстовое поле (timezone, enum и т.д.). |

**В нашей платформе:** все переменные процесса (applicant_data, parsed_report, decision, stop_factors и т.д.) хранятся здесь во время выполнения. После завершения переходят в `ACT_HI_VARINST`.

---

### `ACT_RU_JOB`

**Назначение:** джобы для асинхронного выполнения (async service tasks, message catching events, error retry).

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `TYPE_` | VARCHAR(255) | Тип: `message`, `timer`, `external-worker`. |
| `LOCK_EXP_TIME_` | TIMESTAMP | Время истечения блокировки. |
| `LOCK_OWNER_` | VARCHAR(255) | UUID воркера-исполнителя. |
| `EXCLUSIVE_` | BOOLEAN | Эксклюзивный джоб (только один джоб процесса одновременно). |
| `EXECUTION_ID_` | VARCHAR(64) | Ссылка на execution. |
| `PROCESS_INSTANCE_ID_` | VARCHAR(64) | ID экземпляра. |
| `PROC_DEF_ID_` | VARCHAR(64) | Определение процесса. |
| `ELEMENT_ID_` | VARCHAR(255) | ID элемента BPMN. |
| `ELEMENT_NAME_` | VARCHAR(255) | Имя элемента. |
| `SCOPE_ID_` | VARCHAR(255) | Scope. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `CORRELATION_ID_` | VARCHAR(255) | Correlation ID для matching. |
| `RETRIES_` | INTEGER | Оставшихся попыток повтора. |
| `EXCEPTION_STACK_ID_` | VARCHAR(64) | Ссылка на стек ошибки в `ACT_GE_BYTEARRAY`. |
| `EXCEPTION_MSG_` | VARCHAR(4000) | Сообщение исключения. |
| `DUEDATE_` | TIMESTAMP | Срок выполнения (для таймеров). |
| `REPEAT_` | VARCHAR(255) | Repeat expression (для таймеров-циклов, ISO 8601). |
| `HANDLER_TYPE_` | VARCHAR(255) | Тип обработчика: `trigger-signal`, `async-continuation` и т.д. |
| `HANDLER_CFG_` | VARCHAR(4000) | Конфигурация обработчика в JSON. |
| `CUSTOM_VALUES_ID_` | VARCHAR(64) | Ссылка на кастомные значения. |
| `CREATE_TIME_` | TIMESTAMP | Время создания. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

### `ACT_RU_TIMER_JOB`

**Назначение:** таймерные джобы (boundary timer events, intermediate catch timer events, timer start events). Ожидают наступления времени срабатывания.

Структура аналогична `ACT_RU_JOB`, плюс:

| Колонка | Тип | Описание |
|---------|-----|---------|
| `DUEDATE_` | TIMESTAMP | **Ключевое поле** — когда таймер должен сработать. |
| `REPEAT_` | VARCHAR(255) | Cron или ISO 8601 повтор (`R3/PT10M`). |
| `REPEAT_OFFSET_` | BIGINT | Смещение для вычисления следующего срабатывания. |

---

### `ACT_RU_SUSPENDED_JOB`

**Назначение:** джобы приостановленных процессов. При `suspend` процесса джобы переносятся сюда и не выполняются.

Структура идентична `ACT_RU_JOB`.

---

### `ACT_RU_DEADLETTER_JOB`

**Назначение:** джобы, которые исчерпали все попытки повтора (`RETRIES_ = 0`). Требуют ручного вмешательства или повторного запуска из Flowable Admin.

Структура идентична `ACT_RU_JOB`.

> **Мониторинг:** наличие записей здесь = сбои в пайплайне Flowable. Нужно проверить `EXCEPTION_MSG_` и `EXCEPTION_STACK_ID_`.

---

### `ACT_RU_EXTERNAL_WORKER_JOB`

**Назначение:** джобы для external worker паттерна (poll-based выполнение задач внешними воркерами).

Структура идентична `ACT_RU_JOB`.

---

### `ACT_RU_EVENT_SUBSCR`

**Назначение:** активные подписки на события (signal, message, compensation events).

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `EVENT_TYPE_` | VARCHAR(255) | Тип события: `signal`, `message`, `compensate`. |
| `EVENT_NAME_` | VARCHAR(255) | Имя события. |
| `EXECUTION_ID_` | VARCHAR(64) | Ссылка на execution. |
| `PROC_INST_ID_` | VARCHAR(64) | ID экземпляра. |
| `ACTIVITY_ID_` | VARCHAR(64) | ID активности в BPMN. |
| `CONFIGURATION_` | VARCHAR(300) | Конфигурация подписки. |
| `CREATED_` | TIMESTAMP | Время создания. |
| `PROC_DEF_ID_` | VARCHAR(64) | ID определения процесса. |
| `SUB_SCOPE_ID_` | VARCHAR(255) | Sub-scope ID. |
| `SCOPE_ID_` | VARCHAR(255) | Scope ID. |
| `SCOPE_DEFINITION_ID_` | VARCHAR(255) | Scope definition. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

### `ACT_RU_IDENTITYLINK`

**Назначение:** связи между задачами/процессами и пользователями/группами. Хранит назначения, кандидатов, владельцев.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `GROUP_ID_` | VARCHAR(255) | ID группы. |
| `TYPE_` | VARCHAR(255) | Тип связи: `assignee`, `candidate`, `owner`, `starter`, `participant`. |
| `USER_ID_` | VARCHAR(255) | ID пользователя. |
| `TASK_ID_` | VARCHAR(64) | Ссылка на задачу. |
| `PROC_INST_ID_` | VARCHAR(64) | Ссылка на экземпляр. |
| `PROC_DEF_ID_` | VARCHAR(64) | Ссылка на определение. |
| `SCOPE_ID_` | VARCHAR(255) | Scope. |
| `SUB_SCOPE_ID_` | VARCHAR(255) | Sub-scope. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `SCOPE_DEFINITION_ID_` | VARCHAR(255) | Scope definition. |

---

## Группа ACT_HI — History (История)

> **Эти таблицы содержат данные завершённых (и активных) процессов.** Уровень истории настраивается: `NONE`, `ACTIVITY`, `AUDIT`, `FULL`.

### `ACT_HI_PROCINST`

**Назначение:** исторические данные экземпляров процессов. Создаётся при старте, обновляется при завершении.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ = `processInstanceId`. |
| `REV_` | INTEGER | Ревизия. |
| `PROC_INST_ID_` | VARCHAR(64) | ID экземпляра (совпадает с `ID_`). |
| `BUSINESS_KEY_` | VARCHAR(255) | Бизнес-ключ. В нашей платформе = `request_id`. |
| `PROC_DEF_ID_` | VARCHAR(64) | Ссылка на определение процесса. |
| `START_TIME_` | TIMESTAMP | Время запуска. |
| `END_TIME_` | TIMESTAMP | Время завершения. NULL = ещё выполняется. |
| `DURATION_` | BIGINT | Длительность в миллисекундах. |
| `START_USER_ID_` | VARCHAR(255) | Пользователь, запустивший процесс. |
| `START_ACT_ID_` | VARCHAR(255) | ID стартового события. |
| `END_ACT_ID_` | VARCHAR(255) | ID завершающего события. |
| `SUPER_PROCESS_INSTANCE_ID_` | VARCHAR(64) | Родительский экземпляр (call activity). |
| `ROOT_PROC_INST_ID_` | VARCHAR(64) | Корневой экземпляр. |
| `DELETE_REASON_` | VARCHAR(4000) | Причина принудительного завершения (при cancel/delete). |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |
| `NAME_` | VARCHAR(255) | Имя экземпляра. |
| `CALLBACK_ID_` | VARCHAR(255) | Callback ID. |
| `CALLBACK_TYPE_` | VARCHAR(255) | Тип callback. |
| `REFERENCE_ID_` | VARCHAR(255) | Внешний ссылочный ID. |
| `REFERENCE_TYPE_` | VARCHAR(255) | Тип ссылки. |
| `PROPAGATED_STAGE_INST_ID_` | VARCHAR(255) | Стадия CMMN. |
| `STATE_` | VARCHAR(255) | Итоговое состояние: `completed`, `deleted`, `active`. |

**Ключевые запросы:**
```sql
-- Найти экземпляр по request_id
SELECT ID_, PROC_DEF_ID_, START_TIME_, END_TIME_, STATE_
FROM ACT_HI_PROCINST
WHERE BUSINESS_KEY_ = '<request_id>'
ORDER BY START_TIME_ DESC;

-- Среднее время обработки за последние 7 дней
SELECT PROC_DEF_ID_,
       AVG(DURATION_) / 1000.0 AS avg_sec,
       COUNT(*) AS total
FROM ACT_HI_PROCINST
WHERE START_TIME_ >= NOW() - INTERVAL '7 days'
  AND END_TIME_ IS NOT NULL
GROUP BY PROC_DEF_ID_;
```

---

### `ACT_HI_ACTINST`

**Назначение:** история активностей (каждый узел BPMN, который был пройден). Самая детальная таблица — позволяет восстановить полный путь выполнения.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `PROC_DEF_ID_` | VARCHAR(64) | Определение процесса. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр процесса. |
| `EXECUTION_ID_` | VARCHAR(64) | Execution. |
| `ACT_ID_` | VARCHAR(255) | ID активности в BPMN (уникальный в рамках определения). |
| `TASK_ID_` | VARCHAR(64) | ID задачи (если активность — User Task). |
| `CALL_PROC_INST_ID_` | VARCHAR(64) | Вызванный экземпляр (call activity). |
| `ACT_NAME_` | VARCHAR(255) | Имя активности. |
| `ACT_TYPE_` | VARCHAR(255) | Тип: `startEvent`, `endEvent`, `serviceTask`, `userTask`, `exclusiveGateway`, `sequenceFlow` и т.д. |
| `ASSIGNEE_` | VARCHAR(255) | Исполнитель (для userTask). |
| `START_TIME_` | TIMESTAMP | Время начала активности. |
| `END_TIME_` | TIMESTAMP | Время завершения. NULL = ещё выполняется. |
| `TRANSACTION_ORDER_` | INTEGER | Порядок внутри транзакции. |
| `DURATION_` | BIGINT | Длительность в миллисекундах. |
| `DELETE_REASON_` | VARCHAR(4000) | Причина отмены. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

### `ACT_HI_TASKINST`

**Назначение:** история пользовательских задач (User Tasks). Отражает все задачи — как завершённые, так и активные.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `PROC_DEF_ID_` | VARCHAR(64) | Определение процесса. |
| `TASK_DEF_ID_` | VARCHAR(64) | ID task definition. |
| `TASK_DEF_KEY_` | VARCHAR(255) | Ключ задачи из BPMN. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр процесса. |
| `EXECUTION_ID_` | VARCHAR(64) | Execution. |
| `SCOPE_ID_` | VARCHAR(255) | Scope. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `SCOPE_DEFINITION_ID_` | VARCHAR(255) | Scope definition. |
| `PARENT_TASK_ID_` | VARCHAR(64) | Родительская задача. |
| `NAME_` | VARCHAR(255) | Имя задачи. |
| `DESCRIPTION_` | VARCHAR(4000) | Описание. |
| `OWNER_` | VARCHAR(255) | Владелец. |
| `ASSIGNEE_` | VARCHAR(255) | Исполнитель. |
| `START_TIME_` | TIMESTAMP | Время создания задачи. |
| `CLAIM_TIME_` | TIMESTAMP | Время захвата. |
| `END_TIME_` | TIMESTAMP | Время завершения. |
| `DURATION_` | BIGINT | Длительность. |
| `DELETE_REASON_` | VARCHAR(4000) | Причина удаления. |
| `PRIORITY_` | INTEGER | Приоритет. |
| `DUE_DATE_` | TIMESTAMP | Дедлайн. |
| `FORM_KEY_` | VARCHAR(255) | Ключ формы. |
| `CATEGORY_` | VARCHAR(255) | Категория. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |
| `LAST_UPDATED_TIME_` | TIMESTAMP | Последнее обновление. |

---

### `ACT_HI_VARINST`

**Назначение:** история переменных процессов. Хранит все версии всех переменных всех завершённых и активных экземпляров.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр процесса. |
| `EXECUTION_ID_` | VARCHAR(64) | Execution. |
| `TASK_ID_` | VARCHAR(64) | Задача (если переменная task-local). |
| `NAME_` | VARCHAR(255) | Имя переменной. |
| `VAR_TYPE_` | VARCHAR(100) | Тип: `string`, `integer`, `json`, `serializable` и т.д. |
| `SCOPE_ID_` | VARCHAR(255) | Scope. |
| `SUB_SCOPE_ID_` | VARCHAR(255) | Sub-scope. |
| `SCOPE_TYPE_` | VARCHAR(255) | Тип scope. |
| `BYTEARRAY_ID_` | VARCHAR(64) | Ссылка на `ACT_GE_BYTEARRAY` для бинарных значений. |
| `DOUBLE_` | DOUBLE PRECISION | Числовое значение. |
| `LONG_` | BIGINT | Целочисленное значение. |
| `TEXT_` | VARCHAR(4000) | Строковое значение или JSON (если помещается). |
| `TEXT2_` | VARCHAR(4000) | Вспомогательный текст. |
| `CREATE_TIME_` | TIMESTAMP | Время создания. |
| `LAST_UPDATED_TIME_` | TIMESTAMP | Последнее изменение. |

**В нашей платформе:** переменные процесса после завершения. Используются `build_flowable_result_from_variables()` в `orchestrators/flowable_adapter.py`.

---

### `ACT_HI_DETAIL`

**Назначение:** детальные записи изменений переменных и форм. Создаётся только при уровне истории `FULL`. Позволяет отследить каждое изменение каждой переменной.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `TYPE_` | VARCHAR(255) | Тип: `VariableUpdate`, `FormProperty`. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр. |
| `EXECUTION_ID_` | VARCHAR(64) | Execution. |
| `TASK_ID_` | VARCHAR(64) | Задача. |
| `ACT_INST_ID_` | VARCHAR(64) | Активность. |
| `NAME_` | VARCHAR(255) | Имя переменной/поля формы. |
| `VAR_TYPE_` | VARCHAR(64) | Тип переменной. |
| `REV_` | INTEGER | Ревизия. |
| `TIME_` | TIMESTAMP | Время изменения. |
| `BYTEARRAY_ID_` | VARCHAR(64) | Бинарные данные. |
| `DOUBLE_` | DOUBLE PRECISION | Числовое значение. |
| `LONG_` | BIGINT | Целочисленное значение. |
| `TEXT_` | VARCHAR(4000) | Строковое значение. |
| `TEXT2_` | VARCHAR(4000) | Вспомогательный текст. |

---

### `ACT_HI_IDENTITYLINK`

**Назначение:** история identity links (связей пользователей/групп с задачами и процессами).

Структура аналогична `ACT_RU_IDENTITYLINK`, плюс поле `CREATE_TIME_` (время создания связи).

---

### `ACT_HI_COMMENT`

**Назначение:** комментарии к задачам и экземплярам процессов. Создаются через Flowable UI или API.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `TYPE_` | VARCHAR(255) | Тип: `comment` или `event`. |
| `TIME_` | TIMESTAMP | Время создания. |
| `USER_ID_` | VARCHAR(255) | Автор комментария. |
| `TASK_ID_` | VARCHAR(64) | Ссылка на задачу. |
| `PROC_INST_ID_` | VARCHAR(64) | Ссылка на экземпляр. |
| `ACTION_` | VARCHAR(255) | Действие (`AddComment`, `AddUserLink` и т.д.). |
| `MESSAGE_` | VARCHAR(4000) | Текст сообщения (обрезанный). |
| `FULL_MSG_` | BYTEA | Полный текст сообщения (бинарно). |

---

### `ACT_HI_ATTACHMENT`

**Назначение:** прикреплённые файлы к задачам и процессам.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `USER_ID_` | VARCHAR(255) | Кто прикрепил. |
| `NAME_` | VARCHAR(255) | Имя файла. |
| `DESCRIPTION_` | VARCHAR(4000) | Описание. |
| `TYPE_` | VARCHAR(255) | MIME-тип. |
| `TASK_ID_` | VARCHAR(64) | Задача. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр. |
| `URL_` | VARCHAR(4000) | URL (если внешний). |
| `CONTENT_ID_` | VARCHAR(64) | Ссылка на `ACT_GE_BYTEARRAY`. |
| `TIME_` | TIMESTAMP | Время создания. |

---

## Группа ACT_ID — Identity (Пользователи IDM)

### `ACT_ID_USER`

**Назначение:** пользователи Flowable IDM. Используются для назначения задач в Flowable UI.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ (логин). |
| `REV_` | INTEGER | Ревизия. |
| `FIRST_` | VARCHAR(255) | Имя. |
| `LAST_` | VARCHAR(255) | Фамилия. |
| `DISPLAY_NAME_` | VARCHAR(255) | Отображаемое имя. |
| `EMAIL_` | VARCHAR(255) | Email. |
| `PWD_` | VARCHAR(255) | Хэш пароля. |
| `PICTURE_ID_` | VARCHAR(64) | Аватар (ссылка на `ACT_GE_BYTEARRAY`). |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

> **Важно:** пользователи Flowable IDM (`ACT_ID_USER`) **отделены** от пользователей admin-ui (`admin_users` в config-db). Это два независимых хранилища. Пароль `admin` в Flowable UI = `FLOWABLE_PASSWORD`.

---

### `ACT_ID_GROUP`

**Назначение:** группы пользователей Flowable.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `NAME_` | VARCHAR(255) | Имя группы. |
| `TYPE_` | VARCHAR(255) | Тип: `assignment`, `security-role`. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

### `ACT_ID_MEMBERSHIP`

**Назначение:** членство пользователей в группах (M:N).

| Колонка | Тип | Описание |
|---------|-----|---------|
| `USER_ID_` | VARCHAR(64) | Ссылка на `ACT_ID_USER`. |
| `GROUP_ID_` | VARCHAR(64) | Ссылка на `ACT_ID_GROUP`. |

---

### `ACT_ID_TOKEN`

**Назначение:** токены сессий Flowable UI.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `TOKEN_VALUE_` | VARCHAR(255) | Значение токена. |
| `TOKEN_DATE_` | TIMESTAMP | Время выдачи. |
| `IP_ADDRESS_` | VARCHAR(255) | IP создания. |
| `USER_AGENT_` | VARCHAR(255) | User-Agent браузера. |
| `USER_ID_` | VARCHAR(64) | Ссылка на пользователя. |
| `TOKEN_DATA_` | VARCHAR(2000) | JSON с данными токена. |

---

### `ACT_ID_PRIV`

**Назначение:** привилегии (права) в Flowable IDM.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `NAME_` | VARCHAR(255) | Имя привилегии (например `access-admin`). |

---

### `ACT_ID_PRIV_MAPPING`

**Назначение:** маппинг привилегий на пользователей и группы.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `PRIV_ID_` | VARCHAR(64) | Ссылка на `ACT_ID_PRIV`. |
| `USER_ID_` | VARCHAR(64) | Пользователь (или NULL). |
| `GROUP_ID_` | VARCHAR(64) | Группа (или NULL). |

---

## Группа ACT_EVT — Event Log

### `ACT_EVT_LOG`

**Назначение:** низкоуровневый лог событий движка (опционально). Включается флагом `flowable.enable-audit-logging=true`. В production обычно отключён из-за нагрузки.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `LOG_NR_` | BIGINT | Первичный ключ (автоинкремент). |
| `TYPE_` | VARCHAR(64) | Тип события: `PROCESSINSTANCE_START`, `TASK_COMPLETED` и т.д. |
| `PROC_DEF_ID_` | VARCHAR(64) | Определение процесса. |
| `PROC_INST_ID_` | VARCHAR(64) | Экземпляр. |
| `EXECUTION_ID_` | VARCHAR(64) | Execution. |
| `TASK_ID_` | VARCHAR(64) | Задача. |
| `TIME_STAMP_` | TIMESTAMP | Время события. |
| `USER_ID_` | VARCHAR(255) | Пользователь. |
| `DATA_` | BYTEA | Сериализованные данные события. |
| `LOCK_OWNER_` | VARCHAR(255) | Воркер. |
| `LOCK_TIME_` | TIMESTAMP | Время блокировки. |
| `IS_PROCESSED_` | BOOLEAN | Обработано ли событие. |

---

## Группа FLW — Flowable-specific

### `FLW_CHANNEL_DEFINITION`

**Назначение:** определения каналов для Event Registry (потоковые события).

---

### `FLW_EVENT_DEFINITION`

**Назначение:** определения событий Event Registry.

---

### `FLW_EVENT_DEPLOYMENT`

**Назначение:** деплойменты Event Registry.

---

### `FLW_EVENT_RESOURCE`

**Назначение:** ресурсы Event Registry (JSON-файлы определений).

---

### `FLW_RU_BATCH`

**Назначение:** пакетные операции (batch operations) — миграция процессов, массовое завершение.

| Колонка | Тип | Описание |
|---------|-----|---------|
| `ID_` | VARCHAR(64) | Первичный ключ. |
| `REV_` | INTEGER | Ревизия. |
| `TYPE_` | VARCHAR(64) | Тип операции. |
| `SEARCH_KEY_` | VARCHAR(255) | Ключ поиска. |
| `SEARCH_KEY2_` | VARCHAR(255) | Дополнительный ключ. |
| `CREATE_TIME_` | TIMESTAMP | Время создания. |
| `COMPLETE_TIME_` | TIMESTAMP | Время завершения. |
| `STATUS_` | VARCHAR(255) | Статус. |
| `BATCH_DOC_ID_` | VARCHAR(64) | Документ пакета. |
| `TENANT_ID_` | VARCHAR(255) | Тенант. |

---

## Схема взаимодействия с нашей платформой

```
core-api
  │
  ├── flowable-adapter (orchestrators:8011)
  │     │
  │     ├── POST /flowable-rest/service/runtime/process-instances
  │     │     → создаёт ACT_RU_EXECUTION + ACT_HI_PROCINST
  │     │     → BUSINESS_KEY_ = request_id
  │     │
  │     ├── Polling ACT_RU_EXECUTION (если callback не пришёл)
  │     │
  │     └── GET /flowable-rest/service/history/historic-process-instances/{id}/variables
  │           → читает ACT_HI_VARINST → результат процесса
  │
  └── /internal/cases/complete (callback от Flowable ServiceTask)
        → core-api получает результат
        → finalize_request() → UPDATE requests SET status=...

Flowable Engine:
  ACT_RU_EXECUTION → выполнение → ACT_HI_PROCINST
  ACT_RU_VARIABLE  → переменные → ACT_HI_VARINST
  ACT_RU_TASK      → ручные задачи → ACT_HI_TASKINST
  ACT_RU_JOB       → async tasks → ACT_HI_ACTINST
```

---

## Полезные запросы (Flowable DB)

### Активные процессы прямо сейчас
```sql
SELECT e.ID_, e.BUSINESS_KEY_, e.START_TIME_, d.KEY_ AS process_key, d.VERSION_
FROM ACT_RU_EXECUTION e
JOIN ACT_RE_PROCDEF d ON e.PROC_DEF_ID_ = d.ID_
WHERE e.PARENT_ID_ IS NULL
ORDER BY e.START_TIME_ DESC;
```

### Найти процесс по request_id
```sql
SELECT h.ID_, h.BUSINESS_KEY_, h.START_TIME_, h.END_TIME_,
       h.DURATION_ / 1000.0 AS duration_sec, h.STATE_
FROM ACT_HI_PROCINST h
WHERE h.BUSINESS_KEY_ = '<request_id>';
```

### Переменные завершённого процесса
```sql
SELECT v.NAME_, v.VAR_TYPE_, v.TEXT_, v.LONG_, v.DOUBLE_
FROM ACT_HI_VARINST v
WHERE v.PROC_INST_ID_ = '<process_instance_id>'
ORDER BY v.NAME_;
```

### Dead-letter джобы (требуют внимания!)
```sql
SELECT j.ID_, j.RETRIES_, j.EXCEPTION_MSG_,
       e.BUSINESS_KEY_ AS request_id,
       j.CREATE_TIME_
FROM ACT_RU_DEADLETTER_JOB j
LEFT JOIN ACT_RU_EXECUTION e ON j.PROCESS_INSTANCE_ID_ = e.ID_
ORDER BY j.CREATE_TIME_ DESC;
```

### Статистика завершения процессов за 7 дней
```sql
SELECT d.KEY_ AS process_key,
       d.VERSION_,
       COUNT(*) AS total,
       COUNT(CASE WHEN h.STATE_ = 'completed' THEN 1 END) AS completed,
       COUNT(CASE WHEN h.DELETE_REASON_ IS NOT NULL THEN 1 END) AS cancelled,
       AVG(h.DURATION_) / 1000.0 AS avg_duration_sec
FROM ACT_HI_PROCINST h
JOIN ACT_RE_PROCDEF d ON h.PROC_DEF_ID_ = d.ID_
WHERE h.START_TIME_ >= NOW() - INTERVAL '7 days'
GROUP BY d.KEY_, d.VERSION_
ORDER BY total DESC;
```

### Задачи, ожидающие выполнения > 1 часа
```sql
SELECT t.ID_, t.NAME_, t.ASSIGNEE_, t.PROC_INST_ID_,
       e.BUSINESS_KEY_ AS request_id,
       t.CREATE_TIME_,
       EXTRACT(EPOCH FROM (NOW() - t.CREATE_TIME_)) / 3600 AS hours_waiting
FROM ACT_RU_TASK t
LEFT JOIN ACT_RU_EXECUTION e ON t.PROC_INST_ID_ = e.PROC_INST_ID_ AND e.PARENT_ID_ IS NULL
WHERE t.CREATE_TIME_ < NOW() - INTERVAL '1 hour'
ORDER BY t.CREATE_TIME_;
```

### Последние деплойменты BPMN
```sql
SELECT d.ID_, d.NAME_, d.DEPLOY_TIME_,
       COUNT(p.ID_) AS process_definitions
FROM ACT_RE_DEPLOYMENT d
LEFT JOIN ACT_RE_PROCDEF p ON d.ID_ = p.DEPLOYMENT_ID_
GROUP BY d.ID_, d.NAME_, d.DEPLOY_TIME_
ORDER BY d.DEPLOY_TIME_ DESC
LIMIT 10;
```

---

## Управление историей

Flowable накапливает данные в `ACT_HI_*` бессрочно. Для production рекомендуется настроить очистку:

```sql
-- Удалить историю завершённых процессов старше 90 дней
DELETE FROM ACT_HI_PROCINST
WHERE END_TIME_ < NOW() - INTERVAL '90 days'
  AND STATE_ != 'active';

-- (каскадно через FK удалятся ACT_HI_ACTINST, ACT_HI_VARINST, ACT_HI_TASKINST)
```

Либо использовать Flowable HistoryCleanup job (доступен начиная с Flowable 6.4):
```yaml
flowable:
  history-cleaning-after: P90D    # удалять после 90 дней
  history-cleaning-cycle: 0 0 * * *  # каждую ночь в 00:00
```

---

## Доступ к Flowable DB

| Среда | Host | Port | DB | User | Password |
|-------|------|------|----|------|---------|
| Dev (local) | `localhost` | `5434` | `flowable` | `flowable` | `flowable` (или `$FLOWABLE_DB_PASSWORD`) |
| Docker internal | `flowable-db` | `5432` | `flowable` | `flowable` | `flowable` |
| Production | `flowable-db` (internal only) | `5432` | `flowable` | `flowable` | `$FLOWABLE_DB_PASSWORD` |

> Production: порт 5434 не публикуется (`docker-compose.prod.yml`). Доступ только через `docker exec` или внутренний docker network.
