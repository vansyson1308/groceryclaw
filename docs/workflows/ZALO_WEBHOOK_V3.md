# Zalo Webhook Receiver V3 (Phase 2 + Security Hardening)

## Purpose
Implements async webhook ingestion with strict authenticity checks:
1. Receive `POST /webhook/zalo-oa`.
2. Return HTTP 200 immediately (`Respond to Webhook`).
3. Verify signature **after** 200 using constant-time compare.
4. Enforce replay controls (timestamp window + DB `msg_id` guard).
5. If valid and non-replay, send test reply.
6. If invalid/replay, log and stop processing.

Workflow file: `n8n/workflows/zalo_webhook_receiver_v3.json`.

## Required environment variables
- `ZALO_OA_SECRET`
- `WEBHOOK_REPLAY_WINDOW_SECONDS` (default 300)
- Postgres credential (for `zalo_token_store`, `invoice_log`, `ops_events`)

## Security controls
### Signature verification
Formula:
`SHA256(app_id + timestamp + payload + OA_SECRET)`

Implementation details:
- Uses `crypto.timingSafeEqual` (constant-time compare).
- Rejects missing signature fields.
- Rejects timestamps outside replay window.

### Replay protection
- Canonical guard: query `invoice_log` by `(zalo_user_id, zalo_msg_id)` where `status <> 'failed'`.
- If found, mark as replay and stop processing.
- DB-backed state survives restarts.

### Invalid requests
- Invalid signature/timestamp path logs:
  - `invoice_log` failure marker
  - `ops_events` warning
- No downstream mapping/PO workflow should run on invalid/replayed payload.

## Manual test procedure
1. Activate workflow.
2. Send valid Zalo message.
   - Expect immediate 200 and normal hello reply.
3. Replay same payload with same `msg_id`.
   - Expect no reply branch execution (replay blocked).
4. Tamper signature header.
   - Expect `invalid_signature` log path only.

## SQL checks
```sql
-- invalid signature events
SELECT ts, level, event_type, context
FROM ops_events
WHERE workflow='zalo_webhook_receiver_v3' AND event_type='invalid_signature'
ORDER BY ts DESC
LIMIT 10;

-- replay-blocked events
SELECT ts, level, event_type, context
FROM ops_events
WHERE workflow='zalo_webhook_receiver_v3' AND event_type='replay_blocked'
ORDER BY ts DESC
LIMIT 10;
```

## Notes
- This workflow still responds 200 first (per async PRD pattern).
- Security decision is enforced after ACK: invalid/replay payloads are halted.
