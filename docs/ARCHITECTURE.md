# Architecture Overview — KIOTVIET-TAPHOA

## System Context
The system is an event-driven automation stack centered on **n8n** orchestrating message intake from **Zalo OA**, persistence in **PostgreSQL**, integration with **KiotViet APIs**, and optional invoice extraction via **OpenAI Vision**.

Primary design constraints from PRD:
- Webhook must acknowledge quickly (respond first, process async).
- Product mapping must use **3-tier fallback** to solve cold-start.
- Unit conversion must be first-class in mapping and PO creation.

## Core Components
1. **Zalo OA (user interface)**
   - Receives user messages/files/images and sends interactive replies.
   - Delivers webhook payloads including `event_name`, `msg_id`, sender, attachment URLs.

2. **n8n Workflow Engine (control plane)**
   - Webhook ingestion + async signature verification.
   - Routing by input type (text/image/xml/session action).
   - Flow orchestration for PO creation, product mapping, and price updates.

3. **PostgreSQL (state + learning memory)**
   - Stores mapping dictionary, session state, invoice log, token store, product cache, and global FMCG master.
   - Enables deduplication, retries, and deterministic flow continuity.

4. **KiotViet API (inventory/POS system of record)**
   - OAuth2 auth.
   - Product sync (`GET /products`).
   - Purchase order create (`POST /purchaseorders`).
   - Product update/create (`PUT/POST /products`).

5. **OpenAI Vision (document intelligence)**
   - Used only for image invoice extraction.
   - Produces normalized invoice structures with confidence score for gating.

## End-to-End Data Path
1. Zalo sends webhook payload to n8n endpoint.
2. n8n responds HTTP 200 immediately using respond node.
3. Async verification checks Zalo signature.
4. If valid, payload is routed:
   - XML path → XML parse → normalize.
   - Image path → OpenAI Vision parse → normalize + confidence check.
   - Session response path → continue waiting state handler.
5. Normalized items enter 3-tier mapping:
   - Tier 1: tenant `mapping_dictionary`.
   - Tier 2: shared `global_fmcg_master` candidate + user confirmation.
   - Tier 3: manual barcode capture and product creation flow.
6. Converted items are used to build KiotViet PO.
7. Cost deltas trigger pricing interaction and potential KiotViet selling-price update.
8. Logs and statuses are persisted to support monitoring and retries.

## Mandatory Business Flows

### Flow 1 — Purchase Order Creation
**Purpose:** Process invoice to completed KiotViet PO.
- Inputs: XML (primary MVP) or image-derived normalized items.
- Steps: normalize → map products → apply conversion_rate → create PO.
- Outputs: KiotViet PO ID saved in logs; user acknowledgment message.

### Flow 2 — New Product Mapping (3-tier fallback)
**Purpose:** Resolve unknown items without blocking operations.
- **Tier 1:** Lookup existing tenant mapping.
- **Tier 2:** Fuzzy/full-text match in global master, then ask user to confirm/reject.
- **Tier 3:** Ask user to scan barcode; create KiotViet product; persist learned mapping.
- Outcome: system “learns” for future invoices via mapping_dictionary.

### Flow 3 — Pricing Alert and Update
**Purpose:** Detect cost changes and optionally update selling price.
- Compare incoming (converted) cost with cache/history.
- Notify user with decision options.
- If confirmed, call `PUT /products/{id}` to update retail price.

## Security and Reliability Boundaries
- Signature validation before business processing.
- Token lifecycle workflows for Zalo and KiotViet OAuth.
- Dedup by `msg_id` / invoice hash.
- Session TTL cleanup and retry policy on transient API failures.
- No tenant write access to global master dataset.

## Deployable Runtime Shape (MVP)
- Docker Compose services:
  - `n8n`
  - `postgres`
- Repository conventions:
  - `n8n/workflows/*.json` for exported workflows.
  - `docs/*` for operational guides/ADRs.
  - Optional lightweight Node/TS test harness for pure logic (signature, normalization, mapping decisions).
