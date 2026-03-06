# GroceryClaw

[![V2 CI](https://github.com/vansyson1308/groceryclaw/actions/workflows/v2-ci.yml/badge.svg)](https://github.com/vansyson1308/groceryclaw/actions/workflows/v2-ci.yml)
[![Security Baseline](https://github.com/vansyson1308/groceryclaw/actions/workflows/security-baseline.yml/badge.svg)](https://github.com/vansyson1308/groceryclaw/actions/workflows/security-baseline.yml)

GroceryClaw is an invoice and operations platform with two runtime options: a **Legacy MVP** (n8n-first, low-code) and a **V2 SaaS runtime** (Gateway + Worker + Admin + Postgres + Redis). This README is written for non-coders and operators so you can run V2 locally with copy/paste commands and understand what is safe to expose.


## Current Release

- **Version:** `v0.1.0-rc.1`
- **Status:** Release candidate (RC) pending final CI-equivalent gate reruns from RC2 audit.
- **Changelog:** `CHANGELOG.md`
- **Release notes:** `docs/saas_v2/RELEASE_NOTES_v0.1.0-rc.1.md`
- **Audit evidence:**
  - `docs/saas_v2/RELEASE_AUDIT_REPORT_RC2.md`
  - `docs/saas_v2/RELEASE_AUDIT_CHECKLIST_RC2.md`

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
- `docs/saas_v2/TROUBLESHOOTING_K8S.md`
- `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md`
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
- `POSTGRES_SUPERUSER` / `POSTGRES_SUPERUSER_PASSWORD` (local bootstrap DB admin for container init).
- `POSTGRES_DB` (local DB name).
- `APP_DB_USER` / `APP_DB_PASSWORD` (runtime least-privilege DB role used by app services).
- `REDIS_URL` (canonical Redis connection, e.g. `redis://:password@redis:6379/0`).
- Legacy fallback (`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) is supported temporarily for one release cycle with deprecation warning.
- `WEBHOOK_SIGNATURE_SECRET` (local test secret, not real production secret).
- `READYZ_STRICT` (`true` by default) and optional `READYZ_TIMEOUT_MS` (default `300`).
- `INVITE_PEPPER_B64` (base64-encoded 32-byte pepper).
- `ADMIN_MEK_B64` / `WORKER_MEK_B64` (keep placeholder for local only).

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

## Deploy to Kubernetes (No-code friendly) — Production Template

This section is for operators who want copy/paste commands with minimal guessing.

> Safety defaults:
> - **Gateway is public** (`api.<your-domain>`).
> - **Admin is private by default** (ClusterIP + port-forward when needed).
> - **Postgres and Redis must stay private** (no public LoadBalancer/NodePort).

### What you need before starting

- A managed Kubernetes cluster (EKS/GKE/AKS/DigitalOcean Kubernetes, etc.).
- A domain you control (for example `example.com`).
- Local tools on your laptop:
  - `kubectl`
  - `helm`
  - `dig` or `nslookup`
  - `curl`
- Access to create DNS records for `api.<your-domain>`.

Verify tools:

```bash
kubectl version --client
helm version
dig -v || nslookup -version
curl --version
```

Expected: each command prints version information and exits 0.

### Step 1) Create or connect to a Kubernetes cluster

Provider-agnostic flow:

1. Create a cluster in your cloud console.
2. Download/merge kubeconfig.
3. Select context.

```bash
kubectl config get-contexts
kubectl config use-context <your-cluster-context>
kubectl get nodes
```

Expected: `kubectl get nodes` returns one or more `Ready` nodes.

### Step 2) Install cluster prerequisites (ingress + cert-manager + external-secrets)

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx   --namespace ingress-nginx --create-namespace

helm upgrade --install cert-manager jetstack/cert-manager   --namespace cert-manager --create-namespace   --set crds.enabled=true

helm upgrade --install external-secrets external-secrets/external-secrets   --namespace external-secrets --create-namespace
```

Expected: each Helm command ends with `STATUS: deployed`.

Apply issuer templates from this repo:

```bash
kubectl apply -k infra/k8s/prereqs
kubectl get clusterissuer
```

Expected: `letsencrypt-staging` and `letsencrypt-prod` appear.

### Step 3) Configure DNS for public Gateway

Get ingress external address:

```bash
kubectl -n ingress-nginx get svc
```

Create DNS record:

- `api.<your-domain>` -> ingress external IP/hostname.

Validate DNS:

```bash
dig +short api.<your-domain>
# or
nslookup api.<your-domain>
```

Expected: resolves to your ingress public address.

### Step 4) TLS verification (cert-manager)

After deploy (Step 6), verify cert issuance:

```bash
kubectl get certificate -n groceryclaw-v2
kubectl describe certificate gateway-tls -n groceryclaw-v2
```

Expected: certificate eventually shows `Ready=True`.

### Step 5) Create application secrets

#### Recommended: External Secrets

1. Configure your cloud secret manager and ClusterSecretStore named `cloud-secret-store`.
2. Edit remote key names in `infra/k8s/overlays/prod/external-secrets.example.yaml`.
3. Apply:

```bash
kubectl create namespace groceryclaw-v2 --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n groceryclaw-v2 -f infra/k8s/overlays/prod/external-secrets.example.yaml
```

#### Fallback (manual secret; dev/small teams)

```bash
kubectl create namespace groceryclaw-v2 --dry-run=client -o yaml | kubectl apply -f -
kubectl -n groceryclaw-v2 create secret generic app-secrets   --from-literal=DB_APP_URL='postgresql://app_user:password@postgres.internal:5432/groceryclaw_v2'   --from-literal=DB_ADMIN_URL='postgresql://admin_user:password@postgres.internal:5432/groceryclaw_v2'   --from-literal=REDIS_URL='redis://:password@redis.internal:6379/0'   --from-literal=WEBHOOK_SIGNATURE_SECRET='replace-me'   --from-literal=INVITE_PEPPER_B64='replace-me-base64'   --from-literal=ADMIN_MEK_B64='replace-me-base64'   --from-literal=WORKER_MEK_B64='replace-me-base64'
```

Never commit real secret values.

### Step 6) Apply GroceryClaw manifests

```bash
npm run k8s:audit
kubectl apply -k infra/k8s/overlays/prod
kubectl get deploy,svc,ingress -n groceryclaw-v2
```

Expected:

- Deployments `gateway`, `worker`, `admin` exist.
- Ingress exists for **gateway only**.
- `admin`, `gateway-metrics`, `admin-metrics`, `worker-metrics` are ClusterIP services.

### Step 7) Run migration job

```bash
kubectl create job --from=job/db-v2-migrate db-v2-migrate-$(date +%s) -n groceryclaw-v2
kubectl get jobs -n groceryclaw-v2
kubectl logs -n groceryclaw-v2 job/<migration-job-name>
```

Expected: migration job reaches `Complete` and logs show successful migration steps.

### Step 8) Verify health and run smoke test

Public checks:

```bash
curl -i https://api.<your-domain>/healthz
curl -i https://api.<your-domain>/readyz
```

Expected: both return HTTP `200` once dependencies are healthy.

In-cluster smoke job (recommended):

```bash
kubectl apply -f infra/k8s/overlays/prod/smoke-job.yaml
kubectl wait --for=condition=complete -n groceryclaw-v2 job/v2-smoke --timeout=180s
kubectl logs -n groceryclaw-v2 job/v2-smoke
```

Expected log contains `smoke passed`.

### Step 9) Configure Zalo webhook URL

Set webhook URL in provider console to:

```text
https://api.<your-domain>/webhooks/zalo
```

Ensure provider uses the same signature secret as `WEBHOOK_SIGNATURE_SECRET`.

### Step 10) Canary rollout and rollback by tenant

Canary one or more tenants to V2:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode v2 --apply
npm run canary:status -- --tenants <tenant-uuid>
```

Rollback tenant immediately:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode legacy --apply
```

Infrastructure rollback if needed:

```bash
kubectl rollout undo deployment/gateway -n groceryclaw-v2
kubectl rollout undo deployment/worker -n groceryclaw-v2
kubectl rollout undo deployment/admin -n groceryclaw-v2
```

### Where to go next

- Deployment prerequisites: `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- K8s architecture and overlays: `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- Smoke procedure details: `docs/saas_v2/DEPLOY_K8S_SMOKE.md`
- Monitoring and alerts: `docs/saas_v2/DEPLOY_K8S_MONITORING.md`
- Kubernetes troubleshooting: `docs/saas_v2/TROUBLESHOOTING_K8S.md`
- Verification before customers: `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md`

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
- `docs/saas_v2/TROUBLESHOOTING_K8S.md`
- `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md`
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

Real Postgres DB integration tests (tenant scoping + rollback):

```bash
# Full local flow: start compose postgres, migrate, run real DB tests, teardown
npm run test:v2:db:real:compose

# If you already have DATABASE_URL pointing to a migrated DB:
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_ci npm run test:v2:db:real
```

Security gates:

```bash
npm audit --omit=dev --audit-level=high
```

CI also runs security/perf/reliability gates defined in `.github/workflows/`.


### Redis configuration (canonical)

Use **`REDIS_URL`** everywhere (Gateway/Worker/Admin, Compose, Kubernetes secrets).

Example:

```bash
REDIS_URL=redis://:change_me@redis:6379/0
```

Compatibility shim: if `REDIS_URL` is missing, runtime falls back to `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` and logs a deprecation warning.


### Readiness semantics

- `/healthz`: lightweight process-up signal.
- `/readyz`: dependency readiness (DB `SELECT 1` + Redis `PING`) when `READYZ_STRICT=true` (default).
- Temporary rollback switch: set `READYZ_STRICT=false` to use shallow readiness during incident mitigation.


Invite pepper generation (32-byte base64):

```bash
openssl rand -base64 32
```

Use this value for `INVITE_PEPPER_B64` in Admin and Gateway.


### Worker health endpoints

- Worker internal health server listens on `WORKER_HEALTH_PORT` (default `3002`) when `WORKER_HEALTH_SERVER_ENABLED=true` (default).
- Endpoints:
  - `GET /healthz` (process alive)
  - `GET /readyz` (DB + Redis dependency checks)
- Compose does **not** publish worker ports to host; health checks run container-local only.

### Run mandatory V2 E2E wiring test locally

This test boots a real Docker stack (Postgres + Redis + Gateway + Admin + Worker + stubs), runs migrations, and verifies full end-to-end wiring:

```bash
npm run e2e
```

What it validates:
- Admin invite flow works end-to-end (`POST /tenants` -> `POST /tenants/:id/invites`).
- Gateway consumes invite webhook and creates `tenant_users` membership (onboarding roundtrip).
- Tenant processing mode is switched to `v2` and invoice routing is verified.
- Redis enqueue/dequeue works between gateway and worker.
- Worker processes inbound XML and writes canonical invoice + item rows.
- Duplicate webhook is idempotent (no duplicate canonical invoice / inbound event).
- Notifier deferral and flush basic path works (pending notification transitions to flushed and stub send is observed).

The runner always tears down with `docker compose down -v --remove-orphans` in `finally`.


### Run load + perf gate locally

```bash
npm run load:light
npm run perf:gate
```

By default, perf gate is blocking. Temporary warn-only mode is available only via:

```bash
PERF_GATE_WARN_ONLY=true npm run perf:gate
```
