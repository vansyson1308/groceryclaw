# Changelog

All notable changes to this project are documented in this file.

## [0.1.0-rc.1] - 2026-03-06

### Added
- V2 runtime health and readiness contract across Gateway/Admin/Worker with `/healthz` and strict `/readyz` dependency checks.
- Private metrics surfaces and Kubernetes observability assets (`ServiceMonitor`/`PrometheusRule`) for operator visibility.
- Canonical invite-code helpers and DB migration for base64 pepper (`INVITE_PEPPER_B64`) consume flow.
- Real integration and E2E tooling for Redis/Postgres/service wiring validation.
- Kubernetes deployment templates including smoke test Job and operator deployment guides.
- Release audit artifacts (`RELEASE_AUDIT_REPORT_RC2.md`, `RELEASE_AUDIT_CHECKLIST_RC2.md`).

### Changed
- Standardized DB/Redis configuration to canonical environment variables (`DB_APP_URL`, `DB_ADMIN_URL`, `REDIS_URL`).
- Moved hot and medium-risk SQL paths to parameterized query forms.
- Updated README with no-code Kubernetes deployment steps and explicit safety boundaries.
- Added docs consistency checks (`docs:drift:check`, README path integrity check).

### Security
- Added baseline HTTP security headers for API responses.
- Expanded SQL interpolation guard to reduce reintroduction risk.
- Strengthened webhook verification documentation and production-safe mode guidance.

### Ops
- Added mandatory CI gates for docs drift/path checks, SQL guard, E2E/perf workflows, and kustomize render checks.
- Added release checklist and pre-customer verification guidance for operators.

### Deployment
- Kubernetes manifests aligned for probes, env naming, and private service exposure model.
- Added smoke test and monitoring runbooks for post-deploy validation.

### Known Limitations in RC
- RC2 audit in sandbox is **NO-GO** due environment-limited gates (missing docker/psql/kustomize and restricted audit network path).
- Mode2 webhook verification remains staging-only unless explicitly overridden; production recommendation is mode1.
- ACK latency alert currently uses a conservative proxy metric until histogram/p95 export is available.
