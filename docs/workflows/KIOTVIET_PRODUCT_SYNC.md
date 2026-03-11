# KiotViet Product Sync Workflow (Phase 1)

## Purpose
Implements PRD Phase 1:
- OAuth `client_credentials` token retrieval.
- Product cache sync from KiotViet `GET /api/products`.
- Scheduled sync every 6 hours + manual trigger path.
- Upsert into `kiotviet_product_cache` by unique key `kiotviet_product_id`.

Workflow file: `n8n/workflows/kiotviet_product_sync.json`.

## Import into n8n
1. Open n8n.
2. Go to **Workflows** → **Import from File**.
3. Select `n8n/workflows/kiotviet_product_sync.json`.
4. Assign Postgres credentials on **Upsert Product Cache** node.
5. Save and activate workflow.

## Required Environment Variables
- `KIOTVIET_CLIENT_ID`
- `KIOTVIET_CLIENT_SECRET`
- `KIOTVIET_RETAILER`

## Exact KiotViet Endpoints and Headers (per PRD)
### 1) OAuth token
`POST https://id.kiotviet.vn/connect/token`

Form body:
- `client_id={KIOTVIET_CLIENT_ID}`
- `client_secret={KIOTVIET_CLIENT_SECRET}`
- `grant_type=client_credentials`
- `scopes=PublicApi.Access`

### 2) Product sync
`GET https://public.kiotviet.vn/api/products?pageSize=100&currentItem={offset}&orderBy=createdDate&orderDirection=Desc&includeInventory=true`

Headers:
- `Authorization: Bearer {access_token}`
- `Retailer: {KIOTVIET_RETAILER}`
- `Content-Type: application/json`

## Pagination Logic
The `Fetch Products Paginated` code node applies PRD logic exactly:
- start `currentItem = 0`
- request page with `pageSize = 100`
- if `data.length === 0` stop
- else append products and increment `currentItem += 100`

## DB Upsert Strategy
The `Upsert Product Cache` node writes to `kiotviet_product_cache`:
- conflict key: `kiotviet_product_id`
- action: `ON CONFLICT ... DO UPDATE`
- updates code/name/barcode/category/base_price/cost/inventory/is_active/last_synced_at

## Manual Validation SQL
Run after a workflow execution:

```sql
-- 1) total cached products
SELECT COUNT(*) FROM kiotviet_product_cache;

-- 2) recently synced records
SELECT kiotviet_product_id, product_code, product_name, barcode, last_synced_at
FROM kiotviet_product_cache
ORDER BY last_synced_at DESC
LIMIT 20;

-- 3) verify no duplicate product IDs
SELECT kiotviet_product_id, COUNT(*)
FROM kiotviet_product_cache
GROUP BY kiotviet_product_id
HAVING COUNT(*) > 1;

-- 4) inventory sanity check
SELECT product_code, inventory_quantity, cost, base_price
FROM kiotviet_product_cache
ORDER BY last_synced_at DESC
LIMIT 20;
```

## Security Notes
- No OAuth access tokens are stored in repo artifacts.
- Workflow reads credentials from runtime environment variables.
- Keep n8n credentials and env values in secret storage, not in git.
