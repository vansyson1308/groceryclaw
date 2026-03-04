# V2 Retry & DLQ Policy

## Policy table

| Job type | Max attempts | Backoff | Retriable conditions | Terminal conditions | DLQ criteria |
|---|---:|---|---|---|---|
| `NOTIFY_USER` | `NOTIFIER_MAX_ATTEMPTS` (default 4) | exponential + jitter (`NOTIFIER_RETRY_BASE_MS` / `NOTIFIER_RETRY_MAX_MS`) | 429, transient 5xx, timeout | blocked user, invalid recipient, policy violation, template invalid | attempts exhausted while retriable OR explicit dead-letter write |
| `FLUSH_PENDING_NOTIFICATIONS` | worker retry budget | paced by `WORKER_FLUSH_RATE_PER_MINUTE` | transient adapter/network failures | pending row expired or terminally failed | when flush job repeatedly fails above queue attempt budget |
| `PROCESS_INBOUND_EVENT` | queue attempt budget | queue default retry | transient parse fetch failures | invalid payload/schema/unsafe URL | repeated non-success with retriable errors only |
| `MAP_RESOLVE` | queue attempt budget | queue default retry | transient DB errors | no resolvable mapping after deterministic logic | queue attempts exhausted |
| `KIOTVIET_SYNC` | `KIOTVIET_SYNC_MAX_RETRIES` | linear/exponential backoff via worker config | 429/5xx/timeout | missing active secret, invalid payload | retries exhausted |

## Retriable vs terminal
- Retriable errors should preserve idempotency key and avoid duplicate external side effects.
- Terminal errors must stop retries and move state to terminal markers (`failed_terminal` or `dead_letter`).

## DLQ operational rules
1. Never replay blindly; scope by `tenant_id` + explicit `job_id` list.
2. Replays are dry-run by default (`dlq_replay.ts` requires `--apply`).
3. Every actual replay writes `admin_audit_logs` action `dlq_replay`.
4. Replay should be safe due to idempotency keys and dedupe constraints.
