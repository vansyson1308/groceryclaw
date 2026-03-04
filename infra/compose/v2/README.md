# V2 Compose (Phase 0C Scaffold)

Local V2 compose stack for boundary validation only (no queue/DB business logic yet).

## Boundary posture
- Gateway is the only host-exposed service (`localhost:8080`).
- Admin is private by default (no host port published).
- Postgres and Redis are internal only (no host ports published).
- Worker has no HTTP host exposure.

## Usage
```bash
cp infra/compose/v2/.env.example infra/compose/v2/.env
# edit .env for local overrides if needed

docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml up -d --build
```

Health check:
```bash
curl -i http://127.0.0.1:8080/healthz
```

Shutdown:
```bash
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml down
```

Webhook ingress test:
```bash
curl -i -X POST http://127.0.0.1:8080/webhooks/zalo \
  -H "content-type: application/json" \
  --data @tests/fixtures/zalo_webhook_valid.json
```
