# Release Audit Checklist RC2 (Gate B7)

Date: 2026-03-06  
Branch: `work`  
Scope: Final release audit for V2 public repo usability.

## Gate Status

| Gate | Command / Evidence | Status | Notes |
|---|---|---|---|
| Build | `npm run build` | PASS | TypeScript build completed. |
| Typecheck | `npm run typecheck` | PASS | No type errors. |
| Unit/integration tests | `npm test` | PASS | Test suite passed (`fail=0`). |
| DB migrate | `npm run db:v2:migrate` | FAIL (env) | Missing `psql`/`docker` and no `DB_V2_PSQL_CMD`. |
| DB rollback | `npm run db:v2:rollback` | BLOCKED | Not run due migration precondition failure in this environment. |
| Mandatory E2E | `npm run e2e` | FAIL (env) | Docker Compose unavailable in runner. |
| Perf light | `npm run load:light` | PASS (degraded) | Completed and generated report; DB seed skipped due missing SQL executor. |
| Perf gate | `npm run perf:gate` | PASS | Gate passed on generated perf report. |
| K8s prod render | `kustomize build infra/k8s/overlays/prod` | FAIL (env) | `kustomize` binary missing. |
| README path integrity | `npm run readme:paths:check` | PASS | Paths valid (with explicit local `.env` exception). |
| Docs drift | `npm run docs:drift:check` | PASS | Drift check passed. |
| Dependency vuln scan | `npm audit --omit=dev --audit-level=high` | FAIL (env) | npm advisory API 403 in sandbox network path. |
| gitleaks executable | `gitleaks version` | FAIL (env) | Binary absent locally; CI workflow exists. |
| CodeQL config sanity | `.github/workflows/security-baseline.yml` | PASS | CodeQL workflow present and configured. |
| Gitleaks CI config sanity | `.github/workflows/security-baseline.yml` + `.gitleaks.toml` ref | PASS | Gitleaks action configured in workflow. |

## Required P0 Blockers (for GO)

1. Execute DB migration + rollback in CI-equivalent environment with SQL executor available.
2. Execute mandatory E2E compose gate successfully (Docker available).
3. Execute kustomize build for prod overlay successfully.
4. Execute security scans (`npm audit`, gitleaks) in network/tooling-capable environment.

## Decision

**NO-GO** in current sandbox due environment-blocked mandatory gates listed above.

## Re-run Priority (first in CI-capable runner)

1. `npm run db:v2:migrate`
2. `npm run db:v2:rollback`
3. `npm run e2e`
4. `kustomize build infra/k8s/overlays/prod`
5. `npm audit --omit=dev --audit-level=high`
6. `gitleaks` workflow run / security-baseline workflow confirmation
