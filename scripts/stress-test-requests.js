import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = String(__ENV.BASE_URL || 'https://65.109.174.58').replace(/\/+$/, '')
const GATEWAY_API_KEY = __ENV.GATEWAY_API_KEY || ''
const PRODUCT_TYPE = __ENV.PRODUCT_TYPE || 'loan'
const ORCHESTRATION_MODE = __ENV.ORCHESTRATION_MODE || 'auto'
const SLEEP_SECONDS = Number(__ENV.SLEEP_SECONDS || 0)

if (!GATEWAY_API_KEY) {
  throw new Error('GATEWAY_API_KEY is required')
}

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  insecureSkipTLSVerify: true,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
}

function buildRequestId() {
  return `K6-${__VU}-${__ITER}-${Date.now()}`
}

export default function () {
  const payload = JSON.stringify({
    request_id: buildRequestId(),
    customer_id: `CUST-${__VU}-${__ITER}`,
    iin: '900101123456',
    product_type: PRODUCT_TYPE,
    orchestration_mode: ORCHESTRATION_MODE,
    payload: {
      amount: 5000 + __ITER,
      currency: 'USD',
      term_months: 12,
    },
  })

  const response = http.post(`${BASE_URL}/api/v1/requests`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': GATEWAY_API_KEY,
    },
    tags: { endpoint: 'create_request' },
    timeout: __ENV.TIMEOUT || '30s',
  })

  check(response, {
    'request accepted': (res) => res.status === 200,
    'response has request id': (res) => {
      try {
        return !!JSON.parse(res.body || '{}').request_id
      } catch {
        return false
      }
    },
  })

  if (SLEEP_SECONDS > 0) sleep(SLEEP_SECONDS)
}
