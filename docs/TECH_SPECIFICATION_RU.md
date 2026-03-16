# Credit Platform v5: Техническое задание

## 1. Цель

Разработать и сопровождать кредитную orchestration-платформу, которая:

- принимает внешние заявки через публичный API;
- работает с унифицированным входным профилем заявителя;
- маршрутизирует заявку во внутренний `custom` или `flowable` контур;
- позволяет управлять маршрутизацией, stop factors, pipeline и сервисами через UI;
- сохраняет audit trail, request tracker и итоговый результат для внешних систем.

## 2. Новый внешний контракт

Публичный входной контракт платформы переводится на `Applicant Input v2`.

Внешняя IT-система передает в `POST /api/v1/requests` только профиль заявителя:

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

Ключевые изменения по сравнению с прежним контрактом:

- внешний интегратор больше не передает `request_id`;
- внешний интегратор больше не передает `customer_id`;
- внешний интегратор больше не передает `product_type`;
- внешний интегратор больше не передает `orchestration_mode`;
- routing и выбор контура становятся внутренней ответственностью платформы.

## 3. Внутренняя нормализация

Платформа должна:

- валидировать обязательные поля входного applicant profile;
- нормализовать строковые поля;
- генерировать внутренний `request_id`;
- сохранять исходный applicant snapshot;
- выставлять внутренний `orchestration_mode=auto` по умолчанию;
- принимать решение о маршруте по конфигурации, а не по полю клиента.

## 4. Область охвата

В scope входят:

- публичный API приема заявок;
- Admin UI;
- Core API;
- routing rules;
- stop factors;
- pipeline rules;
- services registry;
- request tracker;
- Flowable runtime и Flowable UI;
- SNP outbound integration;
- audit и user management;
- production deployment и эксплуатационная документация.

Вне scope:

- кредитная policy-логика банка;
- enterprise CRM как финальный источник истины;
- полнофункциональный scoring engine;
- внешняя KYC/AML-верификация;
- mobile UX и экранные сценарии клиента.

## 5. Роли

### Analyst

Может:

- просматривать заявки;
- просматривать tracker;
- просматривать Flowable runtime;
- просматривать audit log.

### Senior analyst

Может:

- управлять routing;
- управлять stop factors;
- управлять pipeline;
- управлять services registry.

### Admin

Может:

- выполнять все действия senior analyst;
- управлять пользователями;
- ревокать сессии;
- сопровождать production configuration.

## 6. Функциональные требования

### 6.1 Прием заявки

Система должна:

- принимать `POST /api/v1/requests`;
- аутентифицировать `GATEWAY_API_KEY`;
- принимать applicant profile в camelCase;
- валидировать обязательные поля:
  - `firstName`
  - `lastName`
  - `address`
  - `city`
  - `state`
  - `zipCode`
  - `ssn`
  - `dateOfBirth`
  - `email`
  - `phone`
- генерировать внутренний `request_id`;
- сохранять заявку и applicant snapshot в БД;
- возвращать клиенту сгенерированный `request_id`.

### 6.2 Routing

Система должна поддерживать три понятных режима routing через UI:

1. все `auto` заявки направлять в `custom`;
2. все `auto` заявки направлять в `flowable`;
3. использовать rule-based routing.

Rule-based routing должен поддерживать:

- `priority`;
- `condition_field`;
- `condition_op`;
- `condition_value`;
- `target_mode`;
- `enabled`;
- fallback-правило.

Внешний клиент не управляет routing через request body.

### 6.3 Stop factors

Система должна применять только активные stop-factor rules.

Правило по умолчанию:

- если активные stop factors есть, система применяет их;
- если активных stop factors нет, заявка проходит дальше без блокировки.

### 6.4 Pipeline

Pipeline должен:

- хранить шаги вызова сервисов;
- поддерживать enable/disable шага;
- поддерживать mode-specific skip policy;
- позволять безопасно исключать вызовы connectors без изменения кода.

### 6.5 Services registry

Система должна позволять через UI:

- менять `base_url`;
- менять `endpoint_path`;
- менять `timeout_ms`;
- менять `retry_count`;
- включать и выключать сервис;
- не терять конфигурацию при временном disable.

### 6.6 Request tracker

Tracker должен:

- фиксировать основные этапы заявки;
- показывать route selection;
- показывать stop-factor decisions;
- показывать outbound и inbound вызовы connectors/processors;
- показывать final state;
- поддерживать просмотр по `request_id`.

### 6.7 Flowable

Система должна:

- поддерживать запуск заявок через Flowable;
- позволять редактировать BPMN через Flowable UI;
- хранить BPMN source of truth в Flowable DB при `FLOWABLE_AUTO_DEPLOY_BPMN=false`;
- обеспечивать безопасный доступ к runtime-данным через `core-api`.

### 6.8 SNP

После финализации заявки платформа должна уметь:

- формировать outbound payload для SNP;
- передавать итоговый статус;
- передавать `request_id`;
- передавать snapshot исходного applicant profile;
- передавать финальный нормализованный result.

## 7. Требования к данным

### 7.1 Applicant Input v2

| Поле | Обязательность | Назначение |
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

### 7.2 Чувствительные поля

К чувствительным полям относятся:

- `ssn`;
- `dateOfBirth`;
- `address`;
- `email`;
- `phone`.

Для них должны быть предусмотрены:

- masking в UI;
- ограниченный вывод в audit/tracker;
- шифрование или иная защита на уровне хранения.

## 8. Нефункциональные требования

### 8.1 Безопасность

- UI не ходит в Flowable REST напрямую;
- Flowable credentials остаются на сервере;
- внешняя IT-система использует только `GATEWAY_API_KEY`;
- admin/internal ключи не используются внешним клиентом;
- все публичные вызовы идут только по HTTPS.

### 8.2 Наблюдаемость

- обязательны health endpoints;
- обязательны metrics;
- обязательна корреляция по request id / correlation id;
- tracker должен позволять отследить причину `FAILED`, `REVIEW`, `REJECTED`.

### 8.3 Эксплуатация

- типовые routing-операции должны быть доступны через UI;
- shell/manual SQL допускаются только как аварийная мера;
- production deployment должен поддерживать one-command bootstrap и full rebuild.

## 9. Критерии приемки

Система считается принятой, если:

1. публичный API принимает applicant profile в новом формате;
2. внешний клиент не обязан передавать `request_id`;
3. платформа возвращает сгенерированный `request_id` в ответе;
4. routing настраивается через UI без изменения request body;
5. stop factors по умолчанию пропускают заявку, если активных правил нет;
6. можно отключить сервис и увидеть корректный `SKIPPED`, а не системную ошибку;
7. request tracker показывает все ключевые этапы по новой модели входных данных;
8. SNP получает финальный результат и snapshot исходной заявки;
9. документация для IT и эксплуатации соответствует Applicant Input v2.

## 10. Ограничения и допущения

- текущая реализация API может еще использовать прежнюю внутреннюю схему, поэтому внешний контракт `Applicant Input v2` должен внедряться синхронно с backend-адаптацией;
- routing остается внутренним механизмом платформы, даже если внешняя система ожидает “определенный” маршрут;
- `request_id` является внутренним идентификатором платформы и не должен считаться клиентским business key;
- для production требуется единая договоренность по masking и retention для `ssn` и персональных данных.
