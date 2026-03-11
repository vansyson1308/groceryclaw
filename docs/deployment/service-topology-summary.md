# Service Topology Summary (Pre-refactor)

## Scope inspected
- `apps/` (gateway, admin, worker)
- `infra/` (compose + k8s base/overlays)
- root `docker-compose.yml`
- root workspace config (`package.json`, `tsconfig.build.json`)
- root `README.md`
- Dockerfiles, deployment manifests, and build/start scripts

---

## A. Findings

### 1) Actual deployable services/processes in repo today

| Service/process | Source path | Entrypoint / start command evidence | Exposed port(s) | HTTP route base | Public vs internal | Type |
|---|---|---|---|---|---|---|
| **gateway** | `apps/gateway` | Docker CMD: `node apps/gateway/dist/server.js`; npm start script exists for gateway | App: 8080 (compose/k8s), metrics: 9100 | `/webhooks/zalo`, `/healthz`, `/readyz`, `/metrics` | **Public-facing primary ingress** | Stateless HTTP app (webhook ingress/API edge) |
| **admin** | `apps/admin` | Docker CMD: `node apps/admin/dist/server.js`; npm start script exists for admin | App: 3001, metrics: 9101 | `/admin/*`, `/tenants/*`, `/healthz`, `/readyz`, `/metrics` | **Internal by default**; optional restricted ingress exists | Admin API/control plane |
| **worker** | `apps/worker` | Docker CMD: `node apps/worker/dist/index.js`; consumes BullMQ queue | Health HTTP: 3002, metrics: 9090 (no business API) | `/healthz`, `/readyz` only; processing is queue-driven | Internal-only | Background worker/job processor |
| **db-v2-migrate job** | `scripts/v2/db_v2_migrate.mjs` + k8s `migrate-job.yaml` | K8s Job runs `npm run db:v2:migrate` | N/A | N/A | Internal one-shot operational job | Migration/batch job |
| **postgres (dependency)** | compose/k8s infra | postgres image | 5432 (host exposed in root compose and v2 compose for local use) | N/A | Internal datastore (should not be public) | DB |
| **redis (dependency)** | `infra/compose/v2`, k8s secrets/config | redis image | 6379 (internal) | N/A | Internal datastore | Cache/queue broker |
| **n8n legacy stack (separate mode)** | root `docker-compose.yml`, `n8n/workflows` | `n8nio/n8n` container | 5678 | n8n UI/webhook surface | Public if deployed from root compose | Legacy workflow engine (not part of V2 app trio) |

### 2) Actual public endpoints (evidence-backed)
- **Gateway ingress endpoint(s)**: the only default internet-facing runtime for V2; receives webhook at `POST /webhooks/zalo` and health endpoints.
- **Admin ingress can be public only if explicitly enabled** via `infra/k8s/overlays/prod-admin-ingress` (commented as not recommended; allowlist required).
- **Legacy n8n endpoint** exists in root compose (`:5678`) but is a different legacy deployment mode than V2.

### 3) Internal-only services
- Worker processing service (queue consumer), worker metrics, worker health endpoint.
- Postgres + Redis.
- Admin in default posture (no host port mapping in V2 compose; cluster-internal service in k8s unless admin ingress overlay is applied).

---

## B. Why DevOps likely said "3 endpoints / 3 repos"

Most likely this statement maps to **three independently deployable application services in V2**:
1. `gateway`
2. `admin`
3. `worker`

Evidence:
- Three separate app workspaces under `apps/*`, each with its own package + Dockerfile + runtime command.
- Three separate k8s Deployments and distinct images (`groceryclaw/gateway`, `groceryclaw/admin`, `groceryclaw/worker`).
- Separate Service objects and separate autoscaling/resource patches.

So "3 endpoints" likely means **3 deploy targets/services (or containers)**, not necessarily 3 public internet URLs. In current topology, only gateway is clearly public by default; admin is optional/restricted; worker is internal/background.

Conflicting signal worth noting:
- The repo still includes a **legacy n8n docker-compose stack** at root, so someone scanning quickly might confuse legacy + V2 and overcount/undercount "endpoints" depending on context.

---

## C. Risk assessment

### If force-splitting into 3 separate repos immediately
High/medium risks:
- **Build coupling risk**: all apps import `@groceryclaw/common` from local workspace path (`file:../../packages/common`). Splitting requires publishing/versioning or vendoring common package first.
- **Migration coupling risk**: one shared migration stream (`db/v2/migrations`) and shared DB schema; migration runner is invoked centrally (`npm run db:v2:migrate`) including from k8s job.
- **Config drift risk**: many env vars are shared across services (`DB_*`, `REDIS_URL`, queue name, secret material, webhook/auth flags). Splitting repos raises coordination overhead and drift risk.
- **Release orchestration risk**: current overlays patch all 3 deployments together and assume coordinated version bumps.

### What is safe to keep in monorepo
- Shared TypeScript package and shared migration scripts.
- Common infra manifests with per-service images/resources.
- Independent service code in `apps/gateway`, `apps/admin`, `apps/worker` already separated logically.

### What should be separated at deploy time even if code remains monorepo
- Build and publish pipelines per app image (`gateway`, `admin`, `worker`).
- Runtime scaling/restart policies per service.
- Rollout controls per service (canary or staged rollout independently).
- Optionally separate ingress policies (gateway public, admin restricted/private, worker internal-only).

---

## D. Recommendation

**Recommended option: Keep monorepo, deploy 3 services from one repo.**

Justification from repo evidence:
- Service boundaries already exist (3 app dirs, 3 Dockerfiles, 3 k8s Deployments/images).
- Shared code and DB migration coupling are strong today; splitting repos now adds operational complexity without immediate runtime benefit.
- Platform requirement of "one service per deploy target" can be satisfied by separate pipelines/images/manifests while preserving monorepo source of truth.

Secondary option (if platform tooling is strict but still supports monorepo):
- "Split into 3 apps inside monorepo with independent deploy configs" is already mostly true; only CI/CD separation needs tightening.

Not recommended right now:
- Immediate split into 3 separate repos before extracting shared package + migration ownership model.

---

## E. Action plan (minimal-change first)

1. **Clarify terminology with DevOps**
   - Confirm whether "endpoint" means URL, container, or deployable service.
   - Use current evidence: V2 has 3 deployable apps but 1 default public ingress.

2. **Codify per-service deploy units in CI/CD without repo split**
   - Build/push `gateway`, `admin`, `worker` images independently from monorepo.
   - Keep versioning independent (tags per service).

3. **Harden deploy-time separation**
   - Ensure gateway ingress is public; admin ingress stays disabled/restricted by default; worker remains internal-only.
   - Keep per-service HPA/resources and readiness checks as-is.

4. **Stabilize shared contract boundaries before any repo split**
   - Extract versioned `@groceryclaw/common` release flow.
   - Define migration ownership and compatibility policy across services.

5. **Only then evaluate repo split**
   - Split if required by org governance/tooling, not merely because there are 3 services.

---

## Quick conclusion
- In V2 topology, this repo contains **3 deployable application services** (gateway/admin/worker), plus infra dependencies (postgres/redis) and a migration job.
- It does **not** represent 3 public endpoints by default.
- DevOps likely meant **3 deploy targets/services**, which can be handled cleanly **without splitting into 3 repos** at this stage.
