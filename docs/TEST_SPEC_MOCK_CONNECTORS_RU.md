# Тестовое ТЗ: Mock Connectors

## Назначение

Документ задает тестовые сценарии для временного mock-сервиса, который заменяет:

- `isoftpull`
- `creditsafe`
- `plaid`

Цель — проверять routing, Flowable BPMN, stop factors и UI на предсказуемых числах и кейсах.

## Общие требования

- mock-сервис должен запускаться отдельно от боевых connector-сервисов;
- подключение mock должно выполняться через замену `base_url` в `Services`;
- `endpoint_path` должен оставаться штатным;
- каждый провайдер должен поддерживать готовые сценарии;
- ключевые цифры должны меняться через API mock-сервиса без редеплоя.

## Provider 1: iSoftPull

### Базовый endpoint

```http
POST /api/pull
```

### Обязательные кейсы

#### `pass_775`

Ожидание:

- `status = COMPLETED`
- `creditScore = 775`
- `collectionCount = 0`
- `intelligenceIndicator = PASS`

Назначение:

- happy-path для Flowable и `custom`

#### `reject_score_550`

Ожидание:

- `status = COMPLETED`
- `creditScore = 550`
- `collectionCount = 0`

Назначение:

- проверка правила Flowable: `credit score < 580 -> REJECTED`

#### `reject_collections_6`

Ожидание:

- `status = COMPLETED`
- `creditScore >= 580`
- `collectionCount = 6`

Назначение:

- проверка правила Flowable: `collection > 5 -> REJECTED`

#### `no_hit`

Ожидание:

- `status = COMPLETED`
- `intelligenceIndicator = NO_HIT`
- отсутствует score

Назначение:

- проверка обработки no-hit кейсов

### Настраиваемые поля

- `creditScore`
- `collectionCount`
- `bureauHit`
- `status`
- `intelligenceIndicator`

## Provider 2: Creditsafe

### Базовый endpoint

```http
POST /api/report
```

### Обязательные кейсы

#### `clean_72`

Ожидание:

- `status = COMPLETED`
- `creditScore = 72`
- `complianceAlertCount = 0`

Назначение:

- happy-path для Creditsafe

#### `reject_alerts_2`

Ожидание:

- `status = COMPLETED`
- `creditScore = 72`
- `complianceAlertCount = 2`

Назначение:

- проверка правила Flowable: `credit safe compliance alert > 1 -> REJECTED`

#### `no_data`

Ожидание:

- `status = COMPLETED`
- `bestMatch = null` или пустой
- отсутствует score

Назначение:

- проверка кейса без матча/без данных

### Настраиваемые поля

- `creditScore`
- `complianceAlertCount`
- `derogatoryCount`
- `status`
- `intelligenceIndicator`

## Provider 3: Plaid

### Базовый endpoint

```http
POST /api/accounts
```

### Обязательные кейсы

#### `pending_link`

Ожидание:

- `status = PENDING`
- `intelligenceIndicator = PENDING_LINK`
- есть `trackingId`
- есть `hostedLinkUrl`

Назначение:

- проверка link-flow и UI отображения pending Plaid

#### `accounts_3`

Ожидание:

- `status = COMPLETED`
- `accountsFound = 3`

Назначение:

- happy-path для счетов/банковских связей

#### `no_accounts`

Ожидание:

- `status = COMPLETED`
- `accountsFound = 0`

Назначение:

- проверка кейса без найденных аккаунтов

#### `failed_missing_ssn`

Ожидание:

- `status = FAILED`
- `errorMessage = SSN is required for Plaid CRA credit check`

Назначение:

- проверка ошибки валидации Plaid

### Настраиваемые поля

- `accountsFound`
- `cashflowStability`
- `status`
- `intelligenceIndicator`
- `errorMessage`

## Матрица бизнес-проверок для Flowable

### Reject by credit score

Настройки:

- `isoftpull = reject_score_550`
- `creditsafe = clean_72`

Ожидание:

- итог Flowable = `REJECTED`
- reason = `Credit score below approval threshold`

### Reject by collections

Настройки:

- `isoftpull = reject_collections_6`
- `creditsafe = clean_72`

Ожидание:

- итог Flowable = `REJECTED`
- reason = `Collection count above approval threshold`

### Reject by compliance alerts

Настройки:

- `isoftpull = pass_775`
- `creditsafe = reject_alerts_2`

Ожидание:

- итог Flowable = `REJECTED`
- reason = `Creditsafe compliance alerts above approval threshold`

### Pending Plaid without reject

Настройки:

- `isoftpull = pass_775`
- `creditsafe = clean_72`
- `plaid = pending_link`

Ожидание:

- заявка не должна падать из-за одного только pending Plaid;
- tracker должен показать pending-ответ от Plaid.

## Критерии приемки

- mock-сервис запускается отдельным контейнером;
- все три endpoint-а отвечают без обращения к внешним системам;
- сценарии переключаются через API;
- числовые поля меняются через `controls`;
- Flowable использует эти цифры для принятия решения;
- кейсы воспроизводимы между тестовыми прогонами.
