# Security Pass (Production-ish)

## Scope
This document covers baseline hardening for webhook authenticity, replay protection, input validation, secret hygiene, data retention, and DB least privilege.

## Threat model (STRIDE-lite)

### 1) Spoofed webhook requests (Spoofing)
- **Threat**: attacker sends fake Zalo webhook payloads to trigger downstream PO actions.
- **Control**:
  - Verify Zalo signature with SHA256 and **constant-time compare**.
  - Reject out-of-window timestamps (`WEBHOOK_REPLAY_WINDOW_SECONDS`, default 300s).
  - If invalid, log event and stop processing after 200 ACK.
- **Residual gap**:
  - If Zalo changes signature construction rules, verification must be updated quickly.

### 2) Replay of valid payloads (Replay/Tampering)
- **Threat**: old valid payload replayed to duplicate processing.
- **Control**:
  - DB-backed replay guard by `(zalo_user_id, zalo_msg_id)` from `invoice_log`; duplicates are blocked.
  - Works across workflow restarts because state is persisted in Postgres.
- **Residual gap**:
  - Events without `msg_id` rely on timestamp window only.

### 3) Token leakage (Information disclosure)
- **Threat**: access tokens/refresh tokens leaked via logs/workflow exports.
- **Control**:
  - Secrets stay in env/n8n credentials only.
  - `ops_event_logger` redacts token/secret/password fields from event context and message.
- **Residual gap**:
  - Manual operator screenshots/exports can still leak if not handled carefully.

### 4) Pricing abuse / malformed user inputs (Tampering)
- **Threat**: invalid barcode/price inputs cause wrong mappings/pricing.
- **Control**:
  - Shared `validate_input` pattern implemented for barcode, custom price bounds, and URL validation.
  - Price bounds configurable via env (`MIN_CUSTOM_PRICE`, `MAX_CUSTOM_PRICE`).

### 5) Prompt injection via invoice image text (Elevation/Tampering)
- **Threat**: image text manipulates model output.
- **Control**:
  - Vision flow uses strict JSON schema validation and confidence thresholds.
  - Low-confidence outputs route to draft-review path.
- **Residual gap**:
  - LLM hallucination risk cannot be zero; human approval remains required for low confidence.

## Controls implemented (current)
1. Webhook signature constant-time verification + timestamp window gate.
2. DB replay guard for `msg_id`.
3. Invalid signatures are logged and processing stops.
4. Input validation pattern for barcode/price/url.
5. Ops event redaction and no secret storage in repo.
6. Weekly retention workflow to minimize sensitive payload retention.

## Known gaps / next hardening backlog
1. Add WAF/rate limit in front of webhook endpoint.
2. Add message queue for async retries and dead-letter handling.
3. Add per-tenant secret scoping and encryption-at-rest for token tables.
4. Add signed callback payload validation for all button handlers (not only session checks).

## Least-privilege DB model (recommended)
Use separate DB roles:
- `app_runtime_rw`: read/write on app tables only.
- `app_ops_writer`: insert-only on `ops_events`, upsert on `ops_metrics_daily`.
- `app_readonly`: read-only for monitoring dashboards.

Example SQL baseline:
```sql
-- create roles
CREATE ROLE app_runtime_rw LOGIN PASSWORD 'rotate_me';
CREATE ROLE app_ops_writer LOGIN PASSWORD 'rotate_me';
CREATE ROLE app_readonly LOGIN PASSWORD 'rotate_me';

-- minimal grants
GRANT CONNECT ON DATABASE kiotviet_taphoa TO app_runtime_rw, app_ops_writer, app_readonly;
GRANT USAGE ON SCHEMA public TO app_runtime_rw, app_ops_writer, app_readonly;

GRANT SELECT, INSERT, UPDATE ON TABLE invoice_log, user_sessions, mapping_dictionary, kiotviet_product_cache, zalo_token_store TO app_runtime_rw;
GRANT INSERT ON TABLE ops_events TO app_ops_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE ops_metrics_daily TO app_ops_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
```

## Security acceptance checklist
- [x] Invalid signature payload does not proceed to business flow.
- [x] Replay by `msg_id` blocked via DB.
- [x] Input validation for barcode/price/url enforced.
- [x] No secrets committed in workflows/docs/env templates.
- [x] Retention cleanup avoids deleting accounting-critical invoice rows.
