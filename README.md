# GroceryClaw

GroceryClaw is an invoice and operations platform with two runtime options: a **Legacy MVP** (n8n-first, low-code) and a **V2 SaaS runtime** (Gateway + Worker + Admin + Postgres + Redis). This README is written for non-coders and operators so you can run V2 locally with copy/paste commands and understand what is safe to expose.

## What GroceryClaw does

- Receives inbound channel events (currently modeled as Zalo webhook payloads).
- Verifies webhook authenticity and rejects spoofed traffic.
- Routes each tenant by `processing_mode` (`legacy` or `v2`) for canary rollout.
- Enqueues async jobs to Redis-backed BullMQ queue for worker processing (parse/map/sync/notify flows).
- Provides private Admin APIs for tenant mode flips, invite flows, and secret rotation/revocation.

## Legacy vs V2: which mode should you use?

### Legacy MVP (n8n)
Use when:
- You need low-code workflow editing.
- You are already operating existing legacy automations.

Main docs:
- `docs/ARCHITECTURE.md`
- `docs/SMOKE_TESTS.md`
- `docs/RUNBOOK.md`

### V2 SaaS Option B (recommended for phased rollout)
Use when:
- You need tenant-scoped controls, RLS-backed data model, CI gates, and canary/rollback discipline.
- You want deterministic scripts for migration, perf/security gates, DLQ replay, backup/restore.

Main docs:
- `docs/saas_v2/RELEASE_CHECKLIST.md`
- `docs/saas_v2/RUNBOOK.md`
- `docs/saas_v2/SECURITY_CHECKLIST.md`
- `docs/saas_v2/SLO_GATES.md`
- `docs/saas_v2/TROUBLESHOOTING.md`
- `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`

---

## V2 architecture (high level)

- **Gateway** (public): receives `/webhooks/zalo`, verifies signatures, acknowledges fast, enqueues jobs.
- **Worker** (private): consumes queue, runs async pipelines.
- **Admin** (private): tenant controls, invites, secret lifecycle.
- **Postgres** (private): V2 schema + migrations + RLS data model.
- **Redis** (private): queue transport.

**Important:** Gateway is the only service intended for public ingress.

---

## Safety first (read before running)

1. **Do NOT expose Admin, Postgres, or Redis to the public internet.**
2. **Gateway is the only public surface.** Put it behind HTTPS/reverse proxy in production.
3. Use firewall/VPN/private network for Admin and data stores.
4. Never commit real secrets/tokens to Git.
5. Keep `WEBHOOK_VERIFY_MODE=mode1` for production-like verification.
6. Rotate/revoke secrets using Admin flows and runbook steps.

---

## Prerequisites (V2 quick start)

Minimum for local Docker run:
- Docker Desktop / Docker Engine + Compose plugin.
- Node.js 20+ and npm.
- Git.
- Recommended machine: 4 CPU, 8 GB RAM, 10+ GB free disk.
- Free host port: `8080` (Gateway).

Optional (for backup/restore scripts):
- `pg_dump`, `pg_restore`, `psql`.

---

## Quick Start (V2, ~10 minutes)

### 1) Clone and install

```bash
git clone <your-repo-url>
cd groceryclaw
npm install
```

### 2) Prepare env file

```bash
cp infra/compose/v2/.env.example infra/compose/v2/.env
```

Open `infra/compose/v2/.env` and set at minimum:
- `WEBHOOK_SIGNATURE_SECRET` (local test secret, not real production secret).
- `ADMIN_INVITE_PEPPER` (random string for dev).
- `ADMIN_MEK_B64` / `WORKER_MEK_B64` (keep placeholder for local only).
- `APP_DB_USER` / `APP_DB_PASSWORD` (runtime least-privilege DB role used by app services).

### 3) One-command up

```bash
make v2-up
```

Expected result:
- Docker containers for `postgres`, `redis`, `gateway`, `admin`, `worker` are running.
- Gateway is reachable on `http://127.0.0.1:8080`.

### 4) Run smoke verification

```bash
make v2-smoke
```

Smoke performs:
1. bring stack up,
2. run V2 migrations,
3. check Gateway `/healthz` and `/readyz`,
4. send signed webhook fixture,
5. verify queue length increased.

Expected final line:
- `Smoke check passed: gateway healthy, signed webhook accepted, queue length=<n>`

### 5) Shut down

```bash
make v2-down
```

To wipe local V2 DB/Redis volumes:

```bash
make v2-reset
```

---

## One-command helpers

From repo root:

```bash
make v2-up      # start stack
make v2-down    # stop stack (keep volumes)
make v2-reset   # stop + remove volumes
make v2-smoke   # run migration + health + webhook + queue smoke test
```

npm alternatives:

```bash
npm run v2:up
npm run v2:down
npm run v2:reset
npm run v2:smoke
```

---

## Verify manually (if you prefer step-by-step)

### Health checks

```bash
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/readyz
```

Expected: HTTP `200` and JSON with `"status":"ok"`.

### Send sample webhook fixture

```bash
BODY_FILE=/tmp/zalo_valid.json
cp tests/fixtures/zalo_webhook_valid.json "$BODY_FILE"
SIG=$(openssl dgst -sha256 -hmac "$(awk -F= '/^WEBHOOK_SIGNATURE_SECRET=/{print $2}' infra/compose/v2/.env)" "$BODY_FILE" | awk '{print $2}')

curl -i -X POST http://127.0.0.1:8080/webhooks/zalo \
  -H 'content-type: application/json' \
  -H "x-zalo-signature: $SIG" \
  --data-binary @"$BODY_FILE"
```

Expected: HTTP `200` and JSON containing `"status":"accepted"`.

---

## Single VPS deployment (low-code operator path)

1. Provision VPS with Docker + Compose and a domain.
2. Clone repo and create `infra/compose/v2/.env` from example.
3. Keep Admin/DB/Redis private (no public port mapping).
4. Put Gateway behind HTTPS reverse proxy (Nginx/Caddy/Traefik).
5. Run:
   ```bash
   make v2-up
   npm run db:v2:migrate
   make v2-smoke
   ```
6. Follow release controls before live traffic:
   - `docs/saas_v2/RELEASE_CHECKLIST.md`
   - `docs/saas_v2/SLO_GATES.md`
   - `docs/saas_v2/SECURITY_CHECKLIST.md`

---

## Deploy to Kubernetes (No-code friendly)

If you can copy/paste commands, you can deploy this template.

### A) Prerequisites (one time)

1. Create a managed Kubernetes cluster (EKS/GKE/AKS/DO).
2. Install local tools:

```bash
kubectl version --client
helm version
```

3. Install cluster addons:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx   --namespace ingress-nginx --create-namespace
helm upgrade --install cert-manager jetstack/cert-manager   --namespace cert-manager --create-namespace --set crds.enabled=true
helm upgrade --install external-secrets external-secrets/external-secrets   --namespace external-secrets --create-namespace
```

Expected output hint: each `helm upgrade --install` ends with `STATUS: deployed`.

4. Create TLS issuers:

```bash
kubectl apply -k infra/k8s/prereqs
kubectl get clusterissuer
```

Expected output hint: `letsencrypt-staging` and `letsencrypt-prod` show `READY=True`.

### B) DNS + secrets

1. Point DNS `api.<your-domain>` to ingress-nginx external IP.
2. Create app secrets (recommended: External Secrets):

```bash
kubectl apply -n groceryclaw-v2 -f infra/k8s/overlays/prod/external-secrets.example.yaml
```

Dev-only fallback (do not commit values):

```bash
kubectl create namespace groceryclaw-v2
kubectl -n groceryclaw-v2 create secret generic app-secrets   --from-literal=POSTGRES_URL='postgres://...'   --from-literal=REDIS_URL='redis://...'   --from-literal=WEBHOOK_SIGNATURE_SECRET='replace-me'   --from-literal=ADMIN_INVITE_PEPPER='replace-me'   --from-literal=ADMIN_MEK_B64='replace-me-b64'   --from-literal=WORKER_MEK_B64='replace-me-b64'
```

### C) Deploy app and run migrations

```bash
kubectl apply -k infra/k8s/overlays/prod
kubectl get deploy,svc,ingress -n groceryclaw-v2

kubectl create job --from=job/db-v2-migrate db-v2-migrate-$(date +%s) -n groceryclaw-v2
kubectl get jobs -n groceryclaw-v2
```

Expected output hint:
- `gateway`, `worker`, `admin` deployments show `AVAILABLE` replicas.
- Ingress exists for `gateway` only.

### D) Verify production health

```bash
kubectl -n groceryclaw-v2 get pods
kubectl -n groceryclaw-v2 logs deploy/gateway --tail=100
curl -i https://api.<your-domain>/healthz
```

Expected output hint: `/healthz` returns HTTP `200`.

Run smoke after each deploy:

```bash
export WEBHOOK_SIGNATURE_SECRET='<same-secret-used-in-cluster>'
npm run k8s:smoke
```

Smoke validates: gateway health, migration job presence, signed fixture webhook accepted, enqueue evidence (Redis queue length or worker log evidence).

### E) Set live webhook endpoint

Set provider webhook URL to:

```text
https://api.<your-domain>/webhooks/zalo
```

### F) Canary rollout and rollback

Canary rollout by tenant:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode v2 --apply
npm run canary:status -- --tenants <tenant-uuid>
```

Immediate rollback:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode legacy --apply
kubectl rollout undo deployment/gateway -n groceryclaw-v2
kubectl rollout undo deployment/worker -n groceryclaw-v2
kubectl rollout undo deployment/admin -n groceryclaw-v2
```

### G) Kubernetes troubleshooting quick list (top 10)

1. **Certificate stuck in Pending**: verify DNS points to ingress LB; run `kubectl describe certificate -n groceryclaw-v2`.
2. **Ingress has no external IP**: check ingress controller service (`kubectl -n ingress-nginx get svc`).
3. **Pods CrashLoopBackOff**: check `kubectl logs deploy/<service> -n groceryclaw-v2` for missing secret/env keys.
4. **Image pull errors**: verify image tag and registry credentials (`kubectl describe pod <pod> -n groceryclaw-v2`).
5. **DB connection failures**: verify `POSTGRES_URL` in `app-secrets` and network policies.
6. **Redis auth/connection failures**: verify `REDIS_URL` and that worker can reach Redis.
7. **Webhook 401/403**: verify `WEBHOOK_SIGNATURE_SECRET` and provider signature header configuration.
8. **Migration job fails**: inspect logs from created migration job and DB permissions.
9. **No worker metrics in Prometheus**: ensure `worker-metrics` service exists and `ServiceMonitor` is applied.
10. **Smoke test fails immediately**: verify local tools are installed (`kubectl`, `curl`, `openssl` for k8s smoke; `docker` for compose smoke).

Before applying to cluster, run static manifest sanity:

```bash
npm run k8s:audit
```

Read the full guides:
- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- `docs/saas_v2/DEPLOY_K8S_MONITORING.md`
- `docs/saas_v2/DEPLOY_K8S_BACKUP.md`

---

## Operations

### Logs

```bash
npm run v2:logs
# or
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml logs -f --tail=200
```

### DLQ and replay tools (safe by default)

```bash
npm run dlq:list -- --tenant-id <tenant-id> --status dead_letter --limit 100
npm run dlq:replay -- --tenant-id <tenant-id> --job-ids <job1,job2>
npm run dlq:replay -- --tenant-id <tenant-id> --job-ids <job1,job2> --apply
```

### Backup / restore

```bash
DB_V2_BACKUP_URL="$DATABASE_URL" npm run db:v2:backup -- backups/v2/latest.dump
DB_V2_RESTORE_URL="$DATABASE_URL" npm run db:v2:restore -- --yes backups/v2/latest.dump
```

More details:
- `docs/saas_v2/RUNBOOK.md`
- `docs/saas_v2/RETRY_POLICY.md`
- `docs/saas_v2/CHAOS_DRILLS.md`

---

## Updating / upgrading safely

```bash
git pull
npm install
make v2-up
npm run db:v2:migrate
make v2-smoke
```

If a release is unhealthy:
- rollback tenant cohort to `processing_mode=legacy` via Admin canary scripts,
- follow `docs/saas_v2/ROLLBACK_DRILL.md` and `docs/saas_v2/RUNBOOK.md`.

---

## Common problems

Use the dedicated troubleshooting guide:
- `docs/saas_v2/TROUBLESHOOTING.md`
- `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`

It covers:
- port conflicts,
- Docker startup failures,
- migration failures,
- webhook auth failures,
- queue not receiving jobs,
- backup/restore issues.

---

## Dev and contribution notes

> **CI note:** Do not delete `package-lock.json`; dependency-audit and reproducible CI installs require it.

> **Dev tooling note:** V2 lint file discovery uses Node globbing (`fast-glob`), so `rg` is not required in CI.

Quality checks:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
```

Security gates:

```bash
npm audit --omit=dev --audit-level=high
```

CI also runs security/perf/reliability gates defined in `.github/workflows/`.
