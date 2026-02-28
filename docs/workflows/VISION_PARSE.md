# Vision Image Invoice Parse (Phase 4)

## Purpose
Parse invoice images via OpenAI Vision into PRD-compatible `ParsedInvoice` and persist full audit trail in `invoice_log`.

Workflow file:
- `n8n/workflows/invoice_image_vision_parse.json`

## Input contract
```json
{
  "zalo_user_id": "user_zalo_id_abc123",
  "zalo_msg_id": "msg_002",
  "image_url": "https://.../invoice.jpg",
  "supplier_hint": "TIEP_DUNG"
}
```

## Preflight validation
- URL must be valid HTTPS.
- MIME allowlist: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.
- Size limit: `<= 10MB` (via `Content-Length` from HEAD response).

Non-compliant inputs are safely rejected and logged as `failed`.

## Vision prompt (exact)
System prompt sent to model:

```text
You are a strict invoice extraction engine. Return ONLY valid JSON. No markdown. No prose. JSON schema: { supplier?: string, invoice_date?: string, items:[{ raw_name:string, quantity:number, unit:string, unit_price:number, total:number, barcode?:string|null, is_promotion?:boolean, confidence:number }], overall_confidence:number }. Rules: confidence 0-100. quantity/unit_price/total numeric. overall_confidence 0-100.
```

User prompt text:

```text
supplier_hint=<supplier_hint>; extract invoice lines now.
```

## Threshold policy
- `overall_confidence >= 85` → `status='processing'`, decision `proceed`
- `60–84` → `status='needs_review'`, decision `draft_required`
- `< 60` → `status='failed'`, decision `resend_image`

## Audit trail behavior
On success:
- write `invoice_log` with:
  - `source_type='image'`
  - `source_url=image_url`
  - `parsed_data` JSONB
  - `llm_confidence=overall_confidence`
  - `status` based on threshold
  - `processing_time_ms`

On invalid parse / invalid input:
- write `invoice_log` with `status='failed'` and `error_details`.

Security:
- store URL + parsed JSON only
- do **not** persist full image bytes in DB
- API key/model are env-driven (`OPENAI_API_KEY`, `OPENAI_VISION_MODEL`)

## How to test
### Clear sample image test
1. Import workflow into n8n.
2. Execute workflow with a clear invoice image URL (HTTPS).
3. Verify result contains:
   - `parsed_invoice.items[]`
   - `overall_confidence`
   - status/decision according to threshold.
4. Verify DB row:
```sql
SELECT source_type, source_url, status, llm_confidence, parsed_data
FROM invoice_log
WHERE zalo_msg_id = '<msg_id>'
ORDER BY created_at DESC
LIMIT 1;
```

### Invalid input tests
1. Non-image URL or unsupported MIME.
2. Image > 10MB.
3. URL not HTTPS.

Expected:
- workflow returns `status='failed'`
- asks user to resend clearer/correct image
- failed row persisted in `invoice_log`.

## Sample image guidance
No bundled licensed invoice images are included in-repo.
To create your own test image safely:
1. Print or draft a mock invoice with fake products/prices.
2. Take a clear phone photo under good lighting.
3. Host it at a temporary HTTPS URL for testing.
