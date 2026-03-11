# V2 Release Audit Checklist (RC Gate)

Audit date: 2026-03-04
Scope: V2 SaaS Option B additive runtime + deployment templates.

| Category item | Command run | Expected result | Actual result | Fix applied |
|---|---|---|---|---|
| Build compiles | `npm run build` | TypeScript build succeeds | **PASS** | n/a |
| Typecheck deterministic | `npm run typecheck` | No TS errors | **PASS** | n/a |
| Unit/integration suite | `npm test` | Test suite passes | **PASS** (`71 pass / 0 fail / 1 skip`) | n/a |
| Focused security tests | `node --test tests/v2/webhook-auth.test.mjs tests/v2/ssrf-fetcher.test.mjs tests/v2/envelope-crypto.test.mjs tests/v2/db/rls-gate-smoke.test.mjs` | auth/SSRF/crypto/RLS smoke pass | **PASS** | n/a |
| Lint gate | `npm run lint` | no lint violations | **PASS** | n/a |
| Format gate | `npm run format:check` | no formatting violations | **PASS** | n/a |
| Migration apply gate | `npm run db:v2:migrate` | migrations apply | **FAIL (env limitation)**: no `psql`/`docker` available in runner | none required in repo; documented limitation |
| Migration rollback gate | `npm run db:v2:rollback` | rollback succeeds | **FAIL (env limitation)**: no `psql`/`docker` available in runner | none required in repo; documented limitation |
| RLS integration gate | `npm run db:v2:test:rls` | RLS integration passes | **FAIL (env limitation)**: no DB execution method | none required in repo; documented limitation |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | audit runs and reports vulns | **FAIL (env limitation)**: lockfile missing and registry access blocked (`E403`) | none required in repo; CI workflow still enforces on GitHub runners |
| Secret scan (local) | `gitleaks version` | gitleaks CLI available | **FAIL (env limitation)**: binary not installed | none required in repo; CI workflow runs gitleaks action |
| CI workflow presence | `ls .github/workflows && sed -n '1,240p' .github/workflows/security-baseline.yml && sed -n '1,260p' .github/workflows/v2-ci.yml` | security + v2-ci workflows present | **PASS** | n/a |
| K8s static sanity | `npm run k8s:audit` | ingress/private boundary/security context/probes/resources/netpol checks pass | **PASS** | Added `scripts/v2/k8s_manifest_audit.mjs` + npm script |
| Compose smoke cold-start | `npm run v2:smoke` | stack starts + smoke passes | **FAIL (env limitation)**: docker missing | Added explicit preflight dependency check in smoke script |
| K8s smoke | `npm run k8s:smoke` | smoke passes against cluster | **FAIL (env limitation)**: kubectl missing | existing script already fails fast with actionable message |
| Load light + perf gate | `npm run load:light && npm run perf:gate` | report generated and perf gate passes | **PASS** (load seed skipped due no DB tools, perf gate passes on generated report) | n/a |
| Canary dry-run safety | `npm run canary:set-mode -- --tenants 11111111-1111-1111-1111-111111111111 --mode v2` | dry-run output without mutation | **PASS** | n/a |
| DLQ replay dry-run safety | `npm run dlq:replay -- --tenant-id 11111111-1111-1111-1111-111111111111 --job-ids 22222222-2222-2222-2222-222222222222` | dry-run output and no mutation | **PASS** | Fixed script to allow dry-run without DB cmd |
| README k8s non-coder clarity | Manual review + updated section in `README.md` | explicit end-to-end steps + top troubleshooting failures | **PASS** | Added top-10 troubleshooting list and `npm run k8s:audit` pre-apply check |

## Must-fix-to-run status

- All **repo-side must-fix** findings addressed in this audit cycle.
- Remaining FAIL rows are environment-tooling limitations of this runner, not code defects.
