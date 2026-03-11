# Seed `global_fmcg_master` (Phase 1.5)

## Why this seed is required
PRD v4 introduces `global_fmcg_master` to solve the cold-start problem: a new tenant with empty `mapping_dictionary` can still get auto-suggestions (Tier 2) instead of manually scanning every product barcode.

- MVP recommendation (PRD): **500–1,000 rows**
- Production target (PRD): **~50,000 rows** with ongoing curation

This repository includes a **sample seed** (`data/global_fmcg_master_sample.csv`) for local development and smoke testing only.

## Seed file schema
CSV columns (must match exactly):

```text
barcode,standard_name,brand,category,supplier_unit,pos_unit,default_conversion_rate
```

## Import script
Script: `scripts/import_global_fmcg_master.sh`

Behavior:
- validates CSV header
- checks `global_fmcg_master` table exists
- fast import via PostgreSQL `COPY` into staging table
- upsert into target table using:
  - `ON CONFLICT (barcode) DO UPDATE`
- safe to rerun without duplicates

## Local usage with Docker Compose
```bash
# 1) Start services
docker compose up -d

# 2) Run DB migration once (if not yet done)
./scripts/db_migrate.sh

# 3) Import sample seed
./scripts/import_global_fmcg_master.sh

# Optional: validate CSV only (no DB actions)
./scripts/import_global_fmcg_master.sh --validate-only
```

## Validation SQL
```sql
-- 1) total row count (must be > 0)
SELECT COUNT(*) FROM global_fmcg_master;

-- 2) basic category distribution
SELECT category, COUNT(*)
FROM global_fmcg_master
GROUP BY category
ORDER BY COUNT(*) DESC;

-- 3) fuzzy search sample (Tiger)
SELECT barcode, standard_name, brand, default_conversion_rate
FROM global_fmcg_master
WHERE standard_name ILIKE '%tiger%lon%';

-- 4) full-text search sample
SELECT barcode, standard_name
FROM global_fmcg_master
WHERE to_tsvector('simple', standard_name) @@ to_tsquery('simple', 'bia & tiger');
```

## Re-run behavior
Re-running `./scripts/import_global_fmcg_master.sh` does **not** create duplicates because upsert key is `barcode`.

## Data governance
- `global_fmcg_master` is platform-level shared reference data.
- Tenant workflows should treat this table as read-only.
- Writes/imports should be admin-only and reviewed.

## Security and data policy
- This repository intentionally ships only a small non-proprietary sample dataset.
- Do not commit private supplier dumps or licensed barcode datasets.
