# Credit Platform v5: Техническое задание

## 1. Общая цель

Разработать и поддерживать кредитную orchestration-платформу, которая:

- принимает заявки через API
- маршрутизирует их в `custom` или `flowable`
- управляет цепочкой внешних сервисов
- позволяет настраивать поведение через UI
- обеспечивает аудит, трассировку и операционное сопровождение

## 2. Цели системы

- обеспечить управляемую оркестрацию credit check запросов
- разделить бизнес-конфигурацию и кодовую реализацию
- дать операционной команде возможность менять маршрутизацию через UI
- поддержать безопасный canary rollout на Flowable
- поддержать BPMN lifecycle через Flowable UI
- обеспечить наблюдаемость и быструю диагностику

## 3. Скоуп

В скоуп входят:

- Admin UI
- Core API
- Routing rules
- Pipeline rules
- Stop factors
- Services registry
- Request tracker
- Flowable operations page
- Flowable UI/modeler
- User management
- Audit log
- Production deployment

Вне базового скоупа:

- внешняя CRM/бюро как реальные enterprise-интеграции
- финальный decision engine уровня банка
- ML scoring
- HA / multi-region deployment

## 4. Основные роли

### Analyst

Может:

- просматривать заявки
- просматривать tracker
- просматривать Flowable engine
- просматривать audit log

### Senior analyst

Может:

- управлять `Scenarios`
- управлять `Routing rules`
- управлять `Pipeline`
- управлять `Stop factors`
- управлять `Services`

### Admin

Может:

- выполнять все действия senior analyst
- создавать и изменять пользователей
- менять роли и ревокать сессии

## 5. Функциональные требования

### 5.1 Прием заявки

Система должна:

- принимать `POST /api/v1/requests`
- аутентифицировать gateway key
- валидировать payload
- применять rate limit
- сохранять заявку в БД

### 5.2 Routing

Система должна:

- поддерживать `flowable`, `custom`, `auto`
- для `auto` выбирать режим по `routing_rules`
- учитывать `priority`
- учитывать `condition_field`, `condition_op`, `condition_value`
- поддерживать canary routing по проценту
- поддерживать sticky routing
- поддерживать daily quota для canary

### 5.3 Stop factors

Система должна:

- поддерживать pre-stop и post-stop проверки
- позволять включать и отключать правила через UI
- поддерживать bulk-операции

### 5.4 Pipeline

Система должна:

- хранить pipeline steps в конфигурации
- позволять включать и отключать шаги
- поддерживать `skip_in_custom`
- поддерживать `skip_in_flowable`

### 5.5 Управление сервисами

Система должна:

- хранить registry сервисов
- позволять менять URL, endpoint, timeout, retries
- позволять отключать сервис без удаления конфигурации

### 5.6 Request tracker

Система должна:

- сохранять события прохождения заявки
- показывать входящие и исходящие данные
- отображать статусы шагов
- поддерживать просмотр истории заявки из UI

### 5.7 Flowable operations

Система должна:

- отображать process instances
- показывать variables
- показывать jobs
- позволять operational view без прямого доступа UI к Flowable REST

### 5.8 BPMN model management

Система должна:

- поддерживать Flowable UI в production
- позволять редактировать BPMN через Modeler
- использовать Flowable DB как source of truth при `FLOWABLE_AUTO_DEPLOY_BPMN=false`

### 5.9 User management

Система должна:

- создавать пользователей в БД
- хранить пароли в hash
- поддерживать session-based UI login
- поддерживать disable/revoke

### 5.10 Audit

Система должна:

- логировать изменения конфигурации
- логировать управляющие действия по Flowable и пользователям
- сохранять actor, role, target, action

## 6. Нефункциональные требования

### 6.1 Безопасность

- UI не должен ходить в Flowable REST напрямую
- секреты не должны утекать в frontend bundle
- API должен использовать ролевую авторизацию
- чувствительные данные должны быть зашифрованы или замаскированы

### 6.2 Наблюдаемость

- обязательны health endpoints
- обязательны metrics
- обязательна трассировка заявок через tracker

### 6.3 Эксплуатация

- типовые сценарии должны быть доступны через UI
- ручная shell-настройка допускается только как аварийная мера
- production deployment должен поддерживать one-command bootstrap

### 6.4 Надежность

- отключенный сервис не должен вызываться оркестратором
- Flowable canary не должен забирать заявки сверх лимита
- система должна сохранять корректный fallback на `custom`

## 7. Архитектурные решения

### 7.1 Routing engine

Routing rule содержит:

- `name`
- `priority`
- `condition_field`
- `condition_op`
- `condition_value`
- `target_mode`
- `enabled`
- `meta`

Поле `meta` используется для:

- `sample_percent`
- `sticky_field`
- `daily_quota_enabled`
- `daily_quota_max`

### 7.2 Canary routing

Canary routing должен:

- работать детерминированно
- использовать sticky identity
- распределять трафик по `sample_percent`
- при исчерпании `daily_quota_max` переключать заявки на следующий matching rule

### 7.3 UI orchestration controls

На странице `Scenarios` должны быть:

- `Route all auto traffic to custom`
- `Prepare custom reports chain`
- `Flowable canary`
  - `Percent`
  - `Sticky field`
  - `Enabled`
  - `Daily quota mode`
  - `Max requests per day`
  - `Apply`
- `Disable all stop factors`

### 7.4 Flowable access model

В production:

- Flowable UI доступен через nginx
- `flowable-modeler`, `flowable-admin`, `flowable-idm` публикуются под доменом платформы
- source of truth для BPMN может быть Flowable DB

## 8. Критерии приемки

Система считается принятой, если:

1. через UI можно перевести весь `auto`-трафик в `custom`
2. через UI можно включить custom reports chain
3. через UI можно включить canary с произвольным процентом
4. через UI можно включить canary с дневным лимитом
5. через UI можно отключить все stop factors
6. через UI можно выключить отдельный сервис
7. заявка корректно отражается в `Requests` и `Process tracker`
8. Flowable UI открывается и позволяет редактировать BPMN
9. изменения доступны после production deploy

## 9. Ограничения и допущения

- daily quota сейчас считается по UTC-суткам
- распределение canary основано на sticky field, а не на случайном выборе в реальном времени
- при отсутствии matching routing rules fallback остается `flowable`
- для production нужен Docker Compose с поддержкой merge features из текущего compose-конфига

## 10. План дальнейшего развития

Следующий этап может включать:

- timezone-aware daily quota
- quota по календарному дню конкретной business timezone
- отдельный quota mode `N requests per day` без процентного routing
- rollback и draft/publish для routing и pipeline
- расширенный audit для сценариев
- экспорт Confluence/Word/PDF из репозитория
