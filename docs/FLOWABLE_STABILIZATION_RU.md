# Why Flowable Was Painful And How We Stabilize It

Короткий рабочий документ для команды: почему интеграция с Flowable заняла слишком много времени и какие правила теперь фиксируем, чтобы не повторять этот цикл.

## Что нас реально тормозило

Это был не один баг и не одна “плохая” технология. Проблема сложилась из нескольких слоёв сразу:

1. `Flowable UI` жил за nginx под подпутём `/flowable-ui/`, а не в корне домена.
2. У `flowable-ui`, `flowable-rest`, `core-api`, `orchestrators` и nginx были разные ожидания по:
   - auth;
   - URL paths;
   - HTTPS headers;
   - Docker DNS / networks.
3. Источник истины для BPMN путался между:
   - файлом в git;
   - тем, что уже задеплоено в Flowable UI / DB.
4. `flowable`-сценарий был async, а UI/operator flow долго не показывал:
   - где процесс реально застрял;
   - завершился ли он;
   - есть ли failed jobs;
   - orphaned ли runtime instance.
5. Параллельно менялся сам предмет интеграции:
   - новый applicant input;
   - unified external applicant backend;
   - mock/live переключение.

То есть основная боль была не “BPMN как идея”, а конфигурационный дрейф между несколькими подсистемами.

## Какие ошибки дали самый большой эффект

### 1. Split source of truth

Если `FLOWABLE_AUTO_DEPLOY_BPMN=false`, то после изменения файла BPMN в git нужно отдельно задеплоить модель в Flowable UI.  
Иначе:
- в репо одна схема;
- в engine другая;
- команда смотрит не на тот процесс.

### 2. Proxy under subpath

`flowable-ui` работает как SPA и чувствителен к:
- `X-Forwarded-Proto`
- `X-Forwarded-Host`
- `X-Forwarded-Port`
- `X-Forwarded-Prefix`

Если это не прокинуть, начинаются:
- mixed content;
- белый экран;
- запросы в кривые URL;
- HTML вместо JSON.

### 3. Async without watchdog

Если Flowable не завершился или callback не дошёл, заявка оставалась в вечном `RUNNING`.  
Без watchdog оператор не понимает:
- процесс ещё идёт;
- failed job;
- потерян callback;
- orphaned runtime instance.

### 4. Network drift between services

Часть падений была не логическая, а сетевая:
- `flowable-rest` не видел connector DNS;
- `core-api` не видел `flowable-rest`;
- nginx видел контейнер, но тот ещё не был готов.

### 5. Auth drift

Особенно опасный случай:
- пароль в `.env.prod`;
- пароль, с которым реально живёт persisted Flowable IDM;
- пароль, который используют `orchestrators`.

Если они расходятся, система выглядит “живой”, но старт процесса падает в `401`.

## Что мы фиксируем как новые правила

### 1. Один внешний вход в Flowable UI

Официальный путь:

```text
https://YOUR_DOMAIN/flowable-ui/
```

Не используем как основной вход:
- `/flowable-ui/index.html`
- `/flowable-modeler/`
- `/flowable-admin/`
- `/flowable-idm/`

Legacy paths допустимы только как redirect compatibility.

### 2. Один service registry entry для внешнего credit backend

Теперь быстрый switch demo/live делается только через:

```text
service.id = credit-backend
```

Меняем:

```text
credit-backend.base_url
```

А не по отдельности:
- `isoftpull`
- `creditsafe`
- `plaid`

Это уменьшает количество конфигурационного дрейфа.

### 3. Watchdog обязателен для async Flowable

Если Flowable не завершился в разумный timeout:
- не держим заявку в бесконечном `RUNNING`;
- финализируем как техническую ошибку;
- даём оператору понятный action.

### 4. Flowable UI и nginx должны стартовать через health-based sequencing

`nginx` не должен зависеть от `service_started` для `flowable-ui`.  
Нужен `service_healthy`, иначе после рестарта легко получить `502` на готовом route.

### 5. Ошибки делим на классы

- `technical`
- `integration`
- `business`

Только так понятно, что:
- надо ретраить;
- надо чинить среду;
- это уже валидный outcome.

## Операционный стандарт

### Если менялся BPMN

1. Обновить git.
2. Пересобрать `orchestrators` и связанный стек.
3. Если `FLOWABLE_AUTO_DEPLOY_BPMN=false`:
   - вручную задеплоить BPMN в Flowable UI.
4. Проверить, что process key не изменился неожиданно.

### Если менялся Flowable proxy / UI

1. Обновить git.
2. Пересоздать:
   - `flowable-ui`
   - `nginx`
3. Проверить:
   - `/flowable-ui/`
   - отсутствие mixed content
   - что `app/rest/*` и `idm/*` отвечают JSON, а не HTML

### Если Flowable заявка зависла

Сначала определить тип:

- есть live runtime instance;
- есть failed jobs;
- callback потерян;
- runtime orphaned.

Дальше:

- `Retry failed Flowable jobs`
- `Reconcile flowable`
- `Terminate runtime`
- `Retry as new`

Но не удалять заявку как будто её не было.

## Что считаем стабилизированным минимумом

Система считается приведённой в порядок, если одновременно выполнено всё ниже:

1. `flowable-ui` открывается по `/flowable-ui/` без белого экрана.
2. `flowable-rest` стартует процесс без `401`.
3. `flowable-rest` видит connector DNS.
4. UI показывает:
   - final outcome;
   - current activity;
   - failed jobs;
   - operator actions.
5. demo/live режим меняется одной настройкой `credit-backend.base_url`.
6. mock backend покрывает:
   - applicant CRUD;
   - iSoftPull;
   - Creditsafe;
   - Plaid link/status/report flow.

## Если бы мы упрощали архитектуру дальше

Реальная альтернатива “не страдать с Flowable” — не писать свой BPMN engine, а выбрать один из двух путей:

1. Оставить Flowable, но жёстко стандартизировать:
   - source of truth;
   - deploy flow;
   - proxy;
   - auth;
   - operator runbook.

2. Уйти из BPMN в кодовый state machine:
   - если orchestration короткий;
   - если нет реальной потребности в визуальном моделировании;
   - если бизнес-правила проще держать в коде, чем в process engine.

Свой BPMN-движок здесь не является коротким путём. Он добавит больше работы, чем снимет.

## Практический вывод

Flowable оказался болезненным не потому, что “плохой”, а потому что:
- слишком много интеграционных швов были не зафиксированы как стандарты;
- source of truth несколько раз менялся;
- вокруг него не было жёсткого operational contract.

С этого момента мы считаем стандартом:
- один UI path;
- один credit-backend entry;
- один deploy flow;
- обязательный watchdog;
- обязательную классификацию ошибок;
- operator actions вместо ручной импровизации.
