# Stress Test

This repository includes a ready-to-run `k6` script for load testing request submission:

- `scripts/stress-test-requests.js`

## Install k6

Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y gnupg ca-certificates
curl -fsSL https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install -y k6
```

## Minimal run

```bash
export BASE_URL=https://65.109.174.58
export GATEWAY_API_KEY=your_gateway_api_key

k6 run scripts/stress-test-requests.js
```

## Example heavier run

```bash
BASE_URL=https://65.109.174.58 \
GATEWAY_API_KEY=your_gateway_api_key \
VUS=25 \
DURATION=2m \
TIMEOUT=45s \
k6 run scripts/stress-test-requests.js
```

## Tunable environment variables

- `BASE_URL`: public base URL of the platform
- `GATEWAY_API_KEY`: gateway key used by `POST /api/v1/requests`
- `VUS`: virtual users, default `10`
- `DURATION`: test duration, default `30s`
- `TIMEOUT`: per-request timeout, default `30s`
- `PRODUCT_TYPE`: default `loan`
- `ORCHESTRATION_MODE`: default `auto`
- `SLEEP_SECONDS`: delay between iterations, default `0`

## Notes

- The script disables TLS verification because bootstrap deployments may use self-signed certificates.
- Each iteration generates a unique `request_id`, so duplicate conflicts do not distort the run.
- Start with a small run on production-sized infrastructure before increasing `VUS`.
