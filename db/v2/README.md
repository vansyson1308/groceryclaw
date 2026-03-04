# V2 Database Foundation (Phase 1A)

All V2 schema assets are additive and isolated from legacy migrations under `db/migrations/`.

## Structure
- `migrations/` — ordered SQL migrations with `-- migrate:up` / `-- migrate:down` sections
- `seed/` — dev-only seed SQL
- `schema_dictionary.json` — machine-readable schema contract for CI drift checks

## Commands
```bash
npm run db:v2:status
npm run db:v2:migrate
npm run db:v2:seed
npm run db:v2:contract
npm run db:v2:test:rls
npm run db:v2:test:bootstrap
npm run db:v2:rollback
```

## SQL execution strategy
Migration scripts run SQL using one of these methods:
1. `DB_V2_PSQL_CMD` (explicit override)
2. `psql` with `DATABASE_URL`
3. `docker compose exec postgres psql` using `infra/compose/v2/.env`

If none are available, scripts fail with a clear error.

## Determinism rules
- Applied migrations are tracked in `schema_migrations_v2` with SHA-256 checksum.
- Re-running `db:v2:migrate` is idempotent; checksum drift on applied files fails.
- `db:v2:rollback` reverts exactly one migration per run (last applied first).
