import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const gatewayBaseUrl = __ENV.LOAD_GATEWAY_URL || 'http://127.0.0.1:8080';
const webhookSecret = __ENV.LOAD_TELEGRAM_WEBHOOK_SECRET || '';
const tenantCount = Number(__ENV.LOAD_TENANT_COUNT || '50');
const userPerTenant = Number(__ENV.LOAD_USERS_PER_TENANT || '10');
const duplicateEvery = Number(__ENV.LOAD_DUPLICATE_EVERY || '7');
const sleepSeconds = Number(__ENV.LOAD_SLEEP_SECONDS || '0.05');
const userIdBase = Number(__ENV.LOAD_USER_ID_BASE || '900000000');

const ackMs = new Trend('gateway_ack_ms', true);
const reqFailed = new Counter('load_errors_total');

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.LOAD_STEADY_RPS || '12'),
      timeUnit: '1s',
      duration: __ENV.LOAD_STEADY_DURATION || '30s',
      preAllocatedVUs: Number(__ENV.LOAD_STEADY_VUS || '20'),
      exec: 'steadyRun'
    },
    burst: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.LOAD_BURST_RPS || '80'),
      timeUnit: '1s',
      duration: __ENV.LOAD_BURST_DURATION || '10s',
      preAllocatedVUs: Number(__ENV.LOAD_BURST_VUS || '80'),
      startTime: __ENV.LOAD_BURST_START || '30s',
      exec: 'burstRun'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    gateway_ack_ms: ['p(95)<200']
  }
};

function buildPayload(iteration, mode) {
  const tenantOrdinal = iteration % Math.max(tenantCount, 1);
  const userOrdinal = iteration % Math.max(userPerTenant, 1);
  // Same numeric Telegram user ids as scripts/v2/load_seed_synthetic.mjs.
  const telegramUserId = userIdBase + tenantOrdinal * 1000 + userOrdinal;
  const duplicate = duplicateEvery > 0 && (iteration % duplicateEvery === 0);
  const modeOffset = mode === 'burst' ? 500000000 : 0;
  const messageId = duplicate ? 1 + Math.floor(iteration / duplicateEvery) : modeOffset + 100000 + iteration;

  return {
    update_id: modeOffset + iteration + 1,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: telegramUserId, type: 'private' },
      from: { id: telegramUserId, is_bot: false, first_name: 'Load' },
      document: { file_id: `load-file-${messageId}`, file_unique_id: `load-u-${messageId}`, file_name: 'invoice.xlsx' },
      caption: 'invoice attached'
    }
  };
}

function postWebhook(iteration, mode) {
  const payload = buildPayload(iteration, mode);
  const body = JSON.stringify(payload);
  const res = http.post(`${gatewayBaseUrl}/webhooks/telegram`, body, {
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': webhookSecret,
      'x-request-id': `${mode}-${iteration}`
    }
  });

  ackMs.add(res.timings.duration);
  const ok = check(res, {
    'accepted': (r) => r.status === 200,
    'json response': (r) => String(r.headers['Content-Type'] || '').includes('application/json')
  });

  if (!ok) {
    reqFailed.add(1);
  }
}

export function steadyRun() {
  postWebhook(__ITER, 'steady');
  sleep(sleepSeconds);
}

export function burstRun() {
  postWebhook(__ITER + 1_000_000, 'burst');
  sleep(sleepSeconds / 2);
}
