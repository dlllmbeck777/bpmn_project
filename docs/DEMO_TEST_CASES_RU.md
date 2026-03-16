# Demo Test Cases

Файл кейсов:

- [scripts/demo-test-cases.json](c:/Users/DTuranov/Downloads/credit-platform-v5-v10/credit-platform-v5/scripts/demo-test-cases.json)

Скрипт запуска:

- [scripts/run-demo-test-cases.py](c:/Users/DTuranov/Downloads/credit-platform-v5-v10/credit-platform-v5/scripts/run-demo-test-cases.py)

## Что входит

Подготовлен набор из 10 демонстрационных кейсов для:

- `flowable`
- `custom`
- reject по score
- reject по collections
- reject по Creditsafe alerts
- boundary-кейсов
- pending Plaid link
- review в `custom`

## Список кейсов

| ID | Смысл | Ожидаемый итог |
| --- | --- | --- |
| `flowable-clean-completed` | чистый happy path | `COMPLETED` |
| `flowable-reject-score-550` | score ниже 580 | `REJECTED` |
| `flowable-boundary-score-580` | граница score = 580 | `COMPLETED` |
| `flowable-reject-collections-6` | collections = 6 | `REJECTED` |
| `flowable-boundary-collections-5` | граница collections = 5 | `COMPLETED` |
| `flowable-reject-creditsafe-alerts-2` | compliance alerts = 2 | `REJECTED` |
| `flowable-boundary-creditsafe-alerts-1` | граница alerts = 1 | `COMPLETED` |
| `custom-reject-score-590-stop-factor` | custom stop factor при score 590 | `REJECTED` |
| `custom-review-no-accounts` | custom review при 0 accounts | `REVIEW` |
| `flowable-pending-plaid-link` | pending Plaid tracking/link | `COMPLETED` |

## Как запускать

### Показать список кейсов

```bash
python scripts/run-demo-test-cases.py --list
```

### Запустить один кейс

```bash
python scripts/run-demo-test-cases.py \
  --api-base https://65.109.174.58 \
  --mock-base https://65.109.174.58/mock-bureaus \
  --gateway-api-key YOUR_GATEWAY_API_KEY \
  --case flowable-reject-score-550 \
  --insecure
```

### Запустить все кейсы подряд

```bash
python scripts/run-demo-test-cases.py \
  --api-base https://65.109.174.58 \
  --mock-base https://65.109.174.58/mock-bureaus \
  --gateway-api-key YOUR_GATEWAY_API_KEY \
  --insecure
```

### Одновременно включить demo connectors перед запуском

```bash
python scripts/run-demo-test-cases.py \
  --api-base https://65.109.174.58 \
  --mock-base https://65.109.174.58/mock-bureaus \
  --gateway-api-key YOUR_GATEWAY_API_KEY \
  --admin-api-key YOUR_ADMIN_API_KEY \
  --enable-demo-connectors \
  --case flowable-clean-completed \
  --insecure
```

### Вернуть live URLs после демо

```bash
python scripts/run-demo-test-cases.py \
  --api-base https://65.109.174.58 \
  --admin-api-key YOUR_ADMIN_API_KEY \
  --restore-live-connectors \
  --insecure
```

## Что делает скрипт

Для каждого кейса:

1. сбрасывает mock-конфигурацию;
2. выставляет нужные сценарии в `mock-bureaus`;
3. отправляет заявку в платформу;
4. ждёт финальный статус;
5. печатает:
   - `request_id`
   - `selected_mode`
   - `final_status`
   - `decision_reason`
   - ожидаемый результат

## Когда это полезно

- демо для руководства;
- UAT без платных bureau-вызовов;
- регрессия decision-логики;
- сравнение `flowable` и `custom`.
