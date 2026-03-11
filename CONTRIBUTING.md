# Contributing to GroceryClaw

Thanks for contributing.

## Ground rules

- Keep PRs small and focused.
- Never commit real secrets/tokens/keys.
- Keep Admin, DB, and Redis private-by-default assumptions intact.
- Update docs when behavior, env vars, or ops workflows change.

## Local setup

```bash
npm install
```

Useful docs:
- `README.md`
- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- `docs/saas_v2/RUNBOOK.md`

## Dev loop (required)

Run before opening a PR:

```bash
npm run build
npm run typecheck
npm test
npm run sql:guard
npm run docs:drift:check
npm run readme:paths:check
```

When applicable (runtime/infra changes), also run:

```bash
npm run e2e
npm run load:light
npm run perf:gate
npm run k8s:kustomize:check
```

If environment limitations prevent running a gate, clearly state it in the PR with exact command/output.

## Code and docs expectations

- Prefer parameterized SQL over interpolation.
- Preserve webhook verification behavior (mode1 production default).
- Keep readiness semantics consistent (`/healthz` shallow, `/readyz` dependency-aware).
- Keep K8s and docs aligned with implementation.

## Pull request checklist

Use `.github/PULL_REQUEST_TEMPLATE.md` and complete all relevant checks before requesting review.
