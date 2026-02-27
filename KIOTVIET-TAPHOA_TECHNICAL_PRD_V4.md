# KIOTVIET-TAPHOA: AI-Optimized Technical PRD & Master Implementation Plan

**Version:** 4.0.0-technical  
**Base Document:** Business PRD v1.0.0  
**Author:** System Architect (AI-Assisted)  
**Target:** Development Team (Vibecoding with AI IDE)  
**Last Updated:** 2026-02-27  

### CHANGELOG v4.0.0 (SaaS Cold Start — Global Master Data)
| # | Issue | Fix Applied | Sections Modified |
|---|---|---|---|
| 5 | Cold Start problem for new tenants — no product mappings exist | Added `global_fmcg_master` table and **3-Tier Fallback Logic** to auto-suggest products from a shared FMCG database before asking user to manually scan barcodes | §1.1, §1.2, §2.1, §2.2, §4.1, §4.2 Node 11a/11b, §5 Phase 1.5/5 |

### CHANGELOG v3.0.0 (Tech Lead Review Fixes)
| # | Issue | Fix Applied | Sections Modified |
|---|---|---|---|
| 1 | Unit Conversion (Thùng→Lon) missing | Added `conversion_rate` to `mapping_dictionary`, unit cost calc in Node 11a & PO builder | §2.1, §2.2, §4.2 Node 11a/11c/11d |
| 2 | Zalo Token expires in 25h, not 90 days | Added `zalo_token_store` table + Phase 0.5 auto-refresh workflow (every 20h) | §2.1, §5 Phase 0.5 |
| 3 | Zalo Webhook 5s timeout vs LLM latency | Nodes 1+2 now use "Respond to Webhook" immediately; all processing is async | §4.1, §4.2 Node 1+2 |
| 4 | LLM missing Vietnamese abbreviations | Added abbreviation mapping rule to GPT-4o-mini system prompt | §4.2 Node 6b |

---

## TABLE OF CONTENTS

1. [System Architecture & Data Flow](#1-system-architecture--data-flow)
2. [Database Schema Design](#2-database-schema-design)
3. [KiotViet API Integration Mapping](#3-kiotviet-api-integration-mapping)
4. [n8n Workflow Blueprints](#4-n8n-workflow-blueprints)
5. [Step-by-Step Vibecoding Plan](#5-step-by-step-vibecoding-plan)
6. [Appendix: Error Codes & Edge Cases](#6-appendix-error-codes--edge-cases)

---

## 1. SYSTEM ARCHITECTURE & DATA FLOW

### 1.1 End-to-End Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        KIOTVIET-TAPHOA SYSTEM                          │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────┐    Webhook (POST)     ┌──────────────────────────────────────┐
│          │  ───────────────────>  │            n8n ENGINE                │
│ ZALO OA  │  Msg/Image/XML/Text   │                                      │
│ (User    │                       │  ┌──────────┐   ┌─────────────────┐  │
│  Interface│  <───────────────────  │  │ Webhook  │──>│ Router/Switch   │  │
│          │    Reply Messages      │  │ Receiver │   │ (msg_type)      │  │
│          │    Inline Buttons      │  └──────────┘   └────────┬────────┘  │
└──────────┘                       │                           │           │
                                   │         ┌─────────────────┼───────┐   │
                                   │         ▼                 ▼       ▼   │
                                   │  ┌────────────┐  ┌──────────┐ ┌────┐ │
                                   │  │XML Parser  │  │Image Flow│ │Text│ │
                                   │  │(Direct JSON)│  │(LLM Call)│ │Cmd │ │
                                   │  └─────┬──────┘  └────┬─────┘ └──┬─┘ │
                                   │        └──────┬───────┘          │   │
                                   │               ▼                  │   │
                                   │  ┌──────────────────────────────────┐ │
                                   │  │    MAPPING & VALIDATION          │ │
                                   │  │    3-Tier Fallback (V4)     <────┘ │
                                   │  │                                  │ │
                                   │  │  Tier 1: mapping_dictionary      │ │
                                   │  │  Tier 2: global_fmcg_master (V4) │ │
                                   │  │  Tier 3: Ask user (barcode scan) │ │
                                   │  └──────────────┬───────────────────┘ │
                                   │                 │                     │
                                   │    ┌────────────┼──────────┐         │
                                   │    ▼            ▼          ▼         │
                                   │ ┌──────┐ ┌──────────┐ ┌──────────┐  │
                                   │ │Flow 1│ │Flow 2    │ │Flow 3    │  │
                                   │ │PO    │ │New       │ │Price     │  │
                                   │ │Create│ │Product   │ │Alert &   │  │
                                   │ │      │ │(Tier 2/3)│ │Update    │  │
                                   │ └──┬───┘ └──┬───────┘ └─────┬────┘  │
                                   │    │        │               │        │
                                   └────┼────────┼───────────────┼────────┘
                                        │        │               │
                                        ▼        ▼               ▼
                                   ┌──────────────────────────────────┐
                                   │         KiotViet POS API         │
                                   │  POST /purchaseorders            │
                                   │  POST /products                  │
                                   │  PUT  /products/{id}             │
                                   │  GET  /products                  │
                                   └──────────────────────────────────┘

  ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
  │  🆕 V4: Global Master DB         │   │     PostgreSQL / Google Sheets   │
  │  ┌────────────────────────────┐  │   │  ┌────────────────────────────┐  │
  │  │ global_fmcg_master         │  │   │  │ mapping_dictionary         │  │
  │  │ (Shared across all tenants)│──┼──>│  │ pricing_rules              │  │
  │  │ ~50,000 FMCG products      │  │   │  │ user_sessions              │  │
  │  │ Seeded via CSV/Excel       │  │   │  │ invoice_log                │  │
  │  └────────────────────────────┘  │   │  │ kiotviet_product_cache     │  │
  └──────────────────────────────────┘   │  │ zalo_token_store           │  │
                                         │  └────────────────────────────┘  │
                                         └──────────────────────────────────┘

                                   ┌──────────────────────────────────┐
                                   │     OpenAI GPT-4o-mini Vision    │
                                   │  - Invoice image OCR & parsing   │
                                   │  - Confidence scoring            │
                                   │  - Promo item detection          │
                                   └──────────────────────────────────┘
```

### 1.2 Data Flow Sequence (Happy Path - Invoice Processing)

```
User(Zalo) ──[1]──> Zalo OA Server ──[2]──> n8n Webhook
                                                  │
                                          [2b] ⚡ Respond HTTP 200 immediately (V3)
                                                  │  (Zalo is satisfied, no retry)
                                                  │
                                          [3] Verify Signature (async)
                                                  │
                                          [4] Detect file type
                                                  │
                                        ┌─────────┴─────────┐
                                     XML│                    │Image
                                        ▼                    ▼
                                   [5a] Parse XML       [5b] Send to GPT-4o-mini
                                   to JSON array             Vision API (10-30s)
                                        │                    │
                                        │               [6b] Parse response +
                                        │                    confidence check
                                        │                    │
                                        └────────┬───────────┘
                                                 ▼
                                        [7] Normalize to InvoiceItems[]
                                                 │
                                        [8] 🆕 V4: 3-TIER FALLBACK LOOKUP
                                                 │
                                ┌────────────────┼────────────────┐
                          TIER 1│          TIER 2│          TIER 3│
                          (Local)       (🆕 Global)        (Manual)
                                ▼                ▼                ▼
                          [8a] Lookup      [8b] Fuzzy match  [8c] Ask user
                          mapping_         global_fmcg_      to scan
                          dictionary       master → confirm  barcode
                                │          via Zalo buttons       │
                                │                │                │
                                │          [8b2] User confirms    │
                                │          → auto-create mapping  │
                                │                │                │
                                └────────┬───────┘                │
                                         │                        │
                                   [9] ⚠️ V3: Apply Unit Conversion
                                        (conversion_rate from mapping/global)
                                        qty * rate, price / rate
                                        │
                                        ▼
                                   [10] POST /purchaseorders
                                        (status=2, paid=100%, converted units)
                                        │
                                        ▼
                                   [11] PRICE CHECK FLOW
                                        Compare old vs new cost (converted)
                                        │
                                   [12] If changed: Alert via Zalo
                                        with inline buttons
                                        │
                                   [13] User response → PUT /products/{id}
```

### 1.3 Webhook Payload Structures

#### 1.3.1 Zalo OA Webhook → n8n (Incoming Message)

```json
// Text message
{
  "app_id": "4321888999",
  "sender": {
    "id": "user_zalo_id_abc123"
  },
  "recipient": {
    "id": "oa_id_xyz789"
  },
  "event_name": "user_send_text",
  "timestamp": "1708905600000",
  "message": {
    "msg_id": "msg_001",
    "text": "893123456789"
  }
}

// Image message
{
  "app_id": "4321888999",
  "sender": { "id": "user_zalo_id_abc123" },
  "recipient": { "id": "oa_id_xyz789" },
  "event_name": "user_send_image",
  "timestamp": "1708905600000",
  "message": {
    "msg_id": "msg_002",
    "attachments": [
      {
        "type": "image",
        "payload": {
          "thumbnail": "https://...",
          "url": "https://zalo-image-url.com/full-res.jpg"
        }
      }
    ]
  }
}

// File message (XML invoice)
{
  "app_id": "4321888999",
  "sender": { "id": "user_zalo_id_abc123" },
  "recipient": { "id": "oa_id_xyz789" },
  "event_name": "user_send_file",
  "timestamp": "1708905600000",
  "message": {
    "msg_id": "msg_003",
    "attachments": [
      {
        "type": "file",
        "payload": {
          "name": "hoadon_20260225.xml",
          "url": "https://zalo-file-url.com/hoadon.xml",
          "size": 15234,
          "type": "application/xml"
        }
      }
    ]
  }
}
```

#### 1.3.2 Normalized Internal Data Structure (After Parsing)

```typescript
// InvoiceItem - the universal format after parsing either XML or Image
interface InvoiceItem {
  line_number: number;           // Row order from bill
  supplier_item_code: string;    // Raw code/name from bill (e.g., "bbc")
  item_name: string;             // Human-readable name (e.g., "Bia Budweiser Chai")
  quantity: number;              // e.g., 24
  unit: string;                  // e.g., "thùng", "chai", "hộp"
  unit_price: number;            // Giá nhập / Cost per unit
  total_amount: number;          // quantity * unit_price
  is_promotion: boolean;         // True = gift/promo item (cost=0)
  barcode: string | null;        // If available from XML
  confidence_score: number;      // 0-100, from LLM. 100 for XML.
}

interface ParsedInvoice {
  supplier_name: string;         // e.g., "TIEP_DUNG"
  invoice_number: string | null; // If extractable
  invoice_date: string;          // ISO date
  items: InvoiceItem[];
  total_bill_amount: number;
  raw_source: "xml" | "image";
  llm_overall_confidence: number; // Average confidence. 100 for XML.
}
```

---

## 2. DATABASE SCHEMA DESIGN

### 2.1 Option A: PostgreSQL Schema (Recommended for Production)

#### Table: `global_fmcg_master` 🆕 V4 — COLD START SOLVER

Shared, read-only reference table of common FMCG (Fast-Moving Consumer Goods) products sold in Vietnamese grocery stores. This table is **global across all tenants** and solves the "Cold Start" problem: when a new user has zero data in their `mapping_dictionary`, the system can still auto-suggest product matches from this master list instead of forcing manual barcode scanning for every single item.

> **🆕 V4 DESIGN RATIONALE:** A brand-new tạp hóa signing up has 0 rows in `mapping_dictionary`. Without `global_fmcg_master`, their first invoice of 30 items would trigger 30 sequential "scan barcode" prompts — terrible UX. With this table, the system can auto-match ~80% of common products (Coca-Cola, Bia Tiger, Sữa Vinamilk, etc.) on day one, only asking for manual input on rare/local items.

```sql
CREATE TABLE global_fmcg_master (
    barcode                 VARCHAR(50) PRIMARY KEY,     -- EAN-13/EAN-8 barcode (e.g., "8934588012099")
    standard_name           VARCHAR(500) NOT NULL,       -- Canonical product name (e.g., "Bia Tiger Lon 330ml")
    brand                   VARCHAR(100),                -- e.g., "Tiger", "Coca-Cola", "Vinamilk"
    category                VARCHAR(100),                -- e.g., "Bia", "Nước ngọt", "Sữa"
    supplier_unit           VARCHAR(50),                 -- Common wholesale unit (e.g., "Thùng")
    pos_unit                VARCHAR(50),                 -- Common retail unit (e.g., "Lon")
    default_conversion_rate INT DEFAULT 1,               -- e.g., 24 (1 Thùng = 24 Lon)
    created_at              TIMESTAMP DEFAULT NOW()
);

-- Full-text search index for fuzzy name matching (Tier 2 lookup)
CREATE INDEX idx_global_fmcg_name ON global_fmcg_master USING gin(to_tsvector('simple', standard_name));
CREATE INDEX idx_global_fmcg_brand ON global_fmcg_master(brand);
CREATE INDEX idx_global_fmcg_category ON global_fmcg_master(category);

-- Note: This table is seeded externally (via Excel/CSV import or web scraping).
-- It is READ-ONLY for tenant workflows — only platform admins can write to it.
-- Target: ~50,000 rows covering common Vietnamese FMCG products.
-- Sources: GS1 Vietnam barcode registry, distributor catalogs, manual curation.
```

**Sample Data:**
```sql
INSERT INTO global_fmcg_master (barcode, standard_name, brand, category, supplier_unit, pos_unit, default_conversion_rate) VALUES
('8934588012099', 'Bia Tiger Lon 330ml',              'Tiger',     'Bia',       'Thùng', 'Lon',  24),
('8934588062001', 'Bia Heineken Lon 330ml',            'Heineken',  'Bia',       'Thùng', 'Lon',  24),
('8935049500308', 'Coca-Cola Lon 330ml',               'Coca-Cola', 'Nước ngọt', 'Thùng', 'Lon',  24),
('8934673583220', 'Sữa Vinamilk Không Đường 180ml',   'Vinamilk',  'Sữa',       'Lốc',  'Hộp',   4),
('8936136160126', 'Mì Hảo Hảo Tôm Chua Cay 75g',     'Hảo Hảo',  'Mì gói',    'Thùng', 'Gói',  30),
('8935024140017', 'Nước mắm Chinsu 500ml',            'Chinsu',    'Gia vị',    'Thùng', 'Chai', 12),
('8934804030128', 'Kem Merino Socola Hộp 450ml',      'Merino',    'Kem',       'Thùng', 'Hộp',  12);
```

#### Table: `mapping_dictionary`

Maps supplier-specific product codes to KiotViet product codes. This is the core "learning" table — it grows as the bot encounters new products.

> **⚠️ V3 CRITICAL: UNIT CONVERSION** — Vietnamese suppliers sell in wholesale units (Thùng/Box), but KiotViet POS tracks inventory in retail units (Lon/Can, Chai/Bottle). The `conversion_rate` column bridges this gap. Example: 1 Thùng = 24 Lon → `conversion_rate = 24`. The system MUST divide the invoice unit_price by conversion_rate to get the real per-unit cost before passing to KiotViet PO and Pricing Logic.

> **🆕 V4 NOTE:** When a product is confirmed via `global_fmcg_master` (Tier 2), a new row is automatically inserted here with `conversion_rate`, `supplier_unit`, `pos_unit` pre-filled from the global table. Future lookups will hit Tier 1 directly — the system learns.

```sql
CREATE TABLE mapping_dictionary (
    id                    SERIAL PRIMARY KEY,
    supplier_code         VARCHAR(100) NOT NULL,     -- e.g., "TIEP_DUNG", "TIEN_MANH"
    supplier_item_code    VARCHAR(200) NOT NULL,     -- Raw code/name from bill (e.g., "bbc", "bia bud chai")
    supplier_item_name    VARCHAR(500),              -- Full name if available
    kiotviet_product_id   BIGINT NOT NULL,           -- KiotViet internal product ID
    kiotviet_product_code VARCHAR(100) NOT NULL,     -- e.g., "SP00123"
    kiotviet_product_name VARCHAR(500),              -- Synced name from KiotViet
    barcode               VARCHAR(50),               -- EAN/UPC barcode
    supplier_unit         VARCHAR(50),               -- Unit from supplier bill (Thùng, Lốc, Két)
    pos_unit              VARCHAR(50),               -- Unit on KiotViet POS (Lon, Chai, Hộp)
    conversion_rate       INT NOT NULL DEFAULT 1,    -- ⚠️ V3: How many POS units in 1 supplier unit
                                                     -- e.g., 1 Thùng = 24 Lon → conversion_rate = 24
                                                     -- e.g., 1 Lốc  = 6 Chai → conversion_rate = 6
                                                     -- e.g., 1 Chai = 1 Chai → conversion_rate = 1 (same unit)
    source                VARCHAR(20) DEFAULT 'manual', -- 🆕 V4: 'manual', 'global_fmcg', 'barcode_scan'
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),

    UNIQUE(supplier_code, supplier_item_code)
);

CREATE INDEX idx_mapping_supplier ON mapping_dictionary(supplier_code, supplier_item_code);
CREATE INDEX idx_mapping_barcode ON mapping_dictionary(barcode);
CREATE INDEX idx_mapping_kiotviet ON mapping_dictionary(kiotviet_product_code);
```

#### Table: `pricing_rules`

Configures margin percentages per category or supplier.

```sql
CREATE TABLE pricing_rules (
    id                SERIAL PRIMARY KEY,
    rule_type         VARCHAR(20) NOT NULL CHECK (rule_type IN ('category', 'supplier', 'product')),
    rule_key          VARCHAR(200) NOT NULL,     -- Category name OR Supplier code OR KiotViet product code
    margin_percent    DECIMAL(5,2) NOT NULL,     -- e.g., 15.00, 20.00, 8.50
    rounding_rule     VARCHAR(20) DEFAULT 'none' CHECK (rounding_rule IN ('none', 'round_100', 'round_500', 'round_1000')),
    priority          INT DEFAULT 0,             -- Higher = takes precedence. product > supplier > category
    is_active         BOOLEAN DEFAULT TRUE,
    notes             TEXT,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW(),

    UNIQUE(rule_type, rule_key)
);

-- Seed data
INSERT INTO pricing_rules (rule_type, rule_key, margin_percent, priority) VALUES
('category', 'Nước ngọt',   15.00, 1),
('category', 'Bia',         12.00, 1),
('category', 'Mỹ phẩm',    20.00, 1),
('category', 'Sữa',         8.00, 1),
('category', 'Bánh kẹo',   18.00, 1),
('category', 'Gia vị',     15.00, 1),
('category', 'DEFAULT',     15.00, 0);  -- Fallback rule
```

#### Table: `user_sessions`

Manages conversational state for Zalo interactions. Critical for multi-step flows (e.g., waiting for barcode scan).

```sql
CREATE TABLE user_sessions (
    id                SERIAL PRIMARY KEY,
    zalo_user_id      VARCHAR(100) NOT NULL,
    session_state     VARCHAR(50) NOT NULL DEFAULT 'idle',
    -- Possible states:
    --   'idle'                        : No active flow
    --   'waiting_for_barcode'         : Bot asked user to scan barcode (Flow 2 - Tier 3)
    --   'waiting_for_global_confirm'  : 🆕 V4: Bot suggested a global_fmcg match, waiting Yes/No
    --   'waiting_for_price_confirm'   : Bot showed price options (Flow 3)
    --   'waiting_for_custom_price'    : User chose "Nhập giá khác" (Flow 3)
    --   'waiting_for_draft_confirm'   : Low confidence bill, draft created (Flow 4)

    context_data      JSONB DEFAULT '{}',
    -- Stores flow-specific data, e.g.:
    -- For waiting_for_barcode:
    --   { "pending_item": { "supplier_item_code": "xxx", "name": "Kem Merino", "qty": 10, "cost": 12000 },
    --     "pending_invoice_id": "inv_session_abc",
    --     "remaining_items": [...] }
    --
    -- 🆕 V4: For waiting_for_global_confirm:
    --   { "pending_item": { ... },
    --     "global_match": { "barcode": "8934588012099", "standard_name": "Bia Tiger Lon 330ml",
    --                        "conversion_rate": 24, "supplier_unit": "Thùng", "pos_unit": "Lon" },
    --     "remaining_items": [...] }
    --
    -- For waiting_for_price_confirm:
    --   { "product_id": 12345, "old_price": 14000, "suggested_price": 14400 }

    pending_invoice   JSONB DEFAULT NULL,         -- Full ParsedInvoice waiting to be processed
    expires_at        TIMESTAMP,                  -- Auto-cleanup stale sessions (TTL: 30 min)
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_session_user ON user_sessions(zalo_user_id);
CREATE INDEX idx_session_state ON user_sessions(session_state);
```

#### Table: `invoice_log`

Audit trail of all processed invoices.

```sql
CREATE TABLE invoice_log (
    id                    SERIAL PRIMARY KEY,
    zalo_user_id          VARCHAR(100) NOT NULL,
    supplier_code         VARCHAR(100),
    source_type           VARCHAR(10) NOT NULL,      -- 'xml' or 'image'
    source_url            TEXT,                       -- Original Zalo file/image URL
    parsed_data           JSONB NOT NULL,             -- Full ParsedInvoice JSON
    kiotviet_po_id        BIGINT,                     -- KiotViet Purchase Order ID (after creation)
    kiotviet_po_code      VARCHAR(100),
    status                VARCHAR(30) DEFAULT 'processing',
    -- 'processing', 'completed', 'draft', 'failed', 'partial'
    error_details         TEXT,
    llm_confidence        DECIMAL(5,2),
    processing_time_ms    INT,
    created_at            TIMESTAMP DEFAULT NOW()
);
```

#### Table: `kiotviet_product_cache`

Local cache of KiotViet products for fast lookup. Refreshed periodically.

```sql
CREATE TABLE kiotviet_product_cache (
    id                    SERIAL PRIMARY KEY,
    kiotviet_product_id   BIGINT NOT NULL UNIQUE,
    product_code          VARCHAR(100) NOT NULL,
    product_name          VARCHAR(500),
    barcode               VARCHAR(50),
    category_id           BIGINT,
    category_name         VARCHAR(200),
    base_price            DECIMAL(12,2),              -- Giá bán hiện tại
    cost                  DECIMAL(12,2),              -- Giá vốn hiện tại
    inventory_quantity    INT,
    is_active             BOOLEAN DEFAULT TRUE,
    last_synced_at        TIMESTAMP DEFAULT NOW(),

    UNIQUE(product_code)
);

CREATE INDEX idx_cache_barcode ON kiotviet_product_cache(barcode);
CREATE INDEX idx_cache_name ON kiotviet_product_cache USING gin(to_tsvector('simple', product_name));
```

#### Table: `zalo_token_store` ⚠️ V3 NEW

Manages Zalo OA Access Token lifecycle. Zalo tokens expire in exactly **25 hours** (not 90 days as previously documented). This table stores the current token and refresh token for automated rotation.

```sql
CREATE TABLE zalo_token_store (
    id                SERIAL PRIMARY KEY,
    token_type        VARCHAR(20) NOT NULL DEFAULT 'oa_access',  -- 'oa_access' or 'oa_refresh'
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    expires_at        TIMESTAMP NOT NULL,          -- Exact expiry: issued_at + 25 hours
    issued_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    refresh_count     INT DEFAULT 0,               -- Track how many times refreshed
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

-- Only one active token at a time
CREATE UNIQUE INDEX idx_zalo_active_token ON zalo_token_store(token_type) WHERE is_active = TRUE;
```

> **⚠️ V3 CRITICAL:** The old PRD stated Zalo tokens last ~90 days. This is WRONG. Zalo OA Access Tokens expire in **25 hours**. The Refresh Token is valid for **3 months** but each refresh generates a new Refresh Token (rolling). If the refresh chain breaks (e.g., server down for 3 months), manual re-authentication is required via Zalo Developer Console.

### 2.2 Option B: Google Sheets Schema (MVP/Quick Start)

If using Google Sheets as the initial database:

| Sheet Name | Columns |
|---|---|
| `global_fmcg_master` 🆕 V4 | `barcode` \| `standard_name` \| `brand` \| `category` \| `supplier_unit` \| `pos_unit` \| `default_conversion_rate` |
| `mapping_dictionary` | `supplier_code` \| `supplier_item_code` \| `kiotviet_product_id` \| `kiotviet_product_code` \| `kiotviet_product_name` \| `barcode` \| `supplier_unit` \| `pos_unit` \| `conversion_rate` \| `source` \| `is_active` \| `updated_at` |
| `pricing_rules` | `rule_type` \| `rule_key` \| `margin_percent` \| `rounding_rule` \| `priority` \| `is_active` |
| `user_sessions` | `zalo_user_id` \| `session_state` \| `context_data_json` \| `pending_invoice_json` \| `expires_at` \| `updated_at` |
| `invoice_log` | `timestamp` \| `zalo_user_id` \| `supplier` \| `source_type` \| `items_json` \| `kiotviet_po_id` \| `status` \| `confidence` |
| `product_cache` | `kiotviet_product_id` \| `product_code` \| `product_name` \| `barcode` \| `category_name` \| `base_price` \| `cost` \| `last_synced` |
| `zalo_tokens` ⚠️ V3 | `token_type` \| `access_token` \| `refresh_token` \| `expires_at` \| `issued_at` \| `is_active` |

> **Note:** Google Sheets has rate limits (60 requests/min). For MVP with a single user (Sếp), this is fine. Migrate to PostgreSQL when scaling.

---

## 3. KIOTVIET API INTEGRATION MAPPING

### 3.1 Authentication

KiotViet uses OAuth2 Client Credentials flow.

```
POST https://id.kiotviet.vn/connect/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}
client_secret={CLIENT_SECRET}
grant_type=client_credentials
scopes=PublicApi.Access
```

Response:
```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 86400,
  "token_type": "Bearer"
}
```

All subsequent API calls require headers:
```
Authorization: Bearer {access_token}
Retailer: {your_retailer_name}
Content-Type: application/json
```

> **n8n Implementation:** Use a Credentials node (OAuth2 Generic) or store token in a global variable with auto-refresh logic (token TTL = 24h, refresh at 23h).

### 3.2 GET /products — Sync Product Cache

```
GET https://public.kiotviet.vn/api/products
  ?pageSize=100
  &currentItem=0
  &orderBy=createdDate
  &orderDirection=Desc
  &includeInventory=true
```

Response (key fields):
```json
{
  "total": 1250,
  "pageSize": 100,
  "data": [
    {
      "id": 12345,
      "code": "SP00123",
      "name": "Bia Budweiser Chai 330ml",
      "barCode": "893123456789",
      "categoryId": 101,
      "categoryName": "Bia",
      "basePrice": 14000,         // Giá bán
      "cost": 10000,              // Giá vốn
      "inventories": [
        {
          "branchId": 1,
          "branchName": "Chi nhánh chính",
          "onHand": 48
        }
      ]
    }
  ]
}
```

**Pagination Logic (n8n Loop):**
```
currentItem = 0
LOOP:
  GET /products?pageSize=100&currentItem={currentItem}
  IF data.length == 0 → BREAK
  ELSE → Upsert to product_cache, currentItem += 100
```

### 3.3 POST /purchaseorders — Create Purchase Order (Flow 1)

#### 3.3.1 Standard PO (100% Payment, Status = Completed)

```json
{
  "branchId": 1,
  "supplierId": 5001,
  "supplierCode": "NCC_TIEP_DUNG",
  "purchaseOrderDetails": [
    {
      "productId": 12345,
      "productCode": "SP00123",
      "quantity": 24,
      "price": 10000,
      "discount": 0,
      "description": ""
    },
    {
      "productId": 12346,
      "productCode": "SP00124",
      "quantity": 10,
      "price": 55000,
      "discount": 0,
      "description": ""
    },
    {
      "productId": 12399,
      "productCode": "SP00199",
      "quantity": 2,
      "price": 0,
      "discount": 0,
      "description": "KM - Hàng tặng (Promo)"
    }
  ],
  "status": 2,
  "statusValue": "Hoàn thành",
  "totalPayment": 790000,
  "description": "Auto-import via KiotViet-Taphoa Bot | Bill: TIEP_DUNG_20260225 | Source: XML",
  "payments": [
    {
      "Method": "Cash",
      "Amount": 790000,
      "AccountId": null
    }
  ]
}
```

**Key Implementation Notes:**

- `status: 2` → Completed (stock is updated immediately)
- `status: 1` → Draft (Flow 4 fallback, stock NOT updated)
- `price: 0` for promotion/gift items (`is_promotion: true`)
- `totalPayment` = sum of all `quantity * price` (excludes promo items)
- `payments[0].Amount` must equal `totalPayment` (no công nợ)
- `description` field: always tag with bot identifier + source for audit trail
- ⚠️ V3: `quantity` and `price` in PO details MUST use **converted values** (post-conversion_rate). If bill says "2 Thùng @ 240,000đ" and conversion_rate=24, send `quantity: 48, price: 10000`. The `totalPayment` remains unchanged regardless of conversion.

#### 3.3.2 Draft PO (Flow 4 - Low Confidence Fallback)

```json
{
  "branchId": 1,
  "supplierId": 5001,
  "purchaseOrderDetails": [
    {
      "productId": 12345,
      "productCode": "SP00123",
      "quantity": 24,
      "price": 10000
    },
    {
      "productId": 0,
      "productCode": "UNKNOWN_ITEM_001",
      "quantity": 12,
      "price": 0,
      "description": "⚠️ CẦN KIỂM TRA: Thùng bia Tiger - Giá mờ không đọc được"
    }
  ],
  "status": 1,
  "statusValue": "Phiếu tạm",
  "description": "⚠️ DRAFT - Cần kiểm tra | Confidence: 45% | Bill: TIEN_MANH_20260225 | Source: Image"
}
```

> **Note:** Draft POs have NO `payments` array and NO `totalPayment`. Human reviews on KiotViet dashboard.

### 3.4 POST /products — Create New Product (Flow 2)

```json
{
  "code": "SP_AUTO_00456",
  "name": "Kem Merino Socola Hộp 450ml",
  "categoryId": 205,
  "barCode": "893123456789",
  "basePrice": 0,
  "cost": 12000,
  "allowsSale": true,
  "unit": "Hộp",
  "description": "Auto-created via KiotViet-Taphoa Bot",
  "inventories": [
    {
      "branchId": 1,
      "onHand": 0
    }
  ]
}
```

**Logic Notes:**
- `code`: Auto-generate with prefix `SP_AUTO_` + sequential number
- `basePrice`: Set to 0 initially. Flow 3 (Pricing Alert) will prompt user to set it
- `cost`: From the invoice line item
- `barCode`: From Zalo camera scan (Flow 2 Tier 3) OR from `global_fmcg_master` (🆕 V4 Tier 2)
- `categoryId`: 🆕 V4: If matched via `global_fmcg_master`, use the `category` field to auto-assign. Otherwise, use a default "Chưa phân loại" category

### 3.5 PUT /products/{id} — Update Selling Price (Flow 3)

```json
PUT https://public.kiotviet.vn/api/products/{productId}

{
  "id": 12345,
  "basePrice": 14400,
  "cost": 12000
}
```

**Logic Notes:**
- Only update `basePrice` (selling price) and optionally `cost`
- `cost` is already updated by the Purchase Order, but explicit update ensures consistency
- This endpoint is idempotent — safe to retry

---

## 4. n8n WORKFLOW BLUEPRINTS

### 4.1 Master Workflow Overview

```
WORKFLOW: KiotViet-Taphoa Master
├── [1]  Zalo Webhook Receiver (Webhook Node)
├── [1b] ⚡ Respond to Webhook (HTTP 200) ← V3: MUST fire within 2s
├── [2]  Signature Verification (async, after response)
├── [3]  Session State Router
│   ├── idle → [4] Message Type Router
│   │   ├── file/xml → [5] XML Parser Flow
│   │   ├── image → [6] LLM Vision Flow (async, 10-30s)
│   │   └── text → [7] Text Command Handler
│   ├── waiting_for_barcode → [8] Barcode Handler (Flow 2 - Tier 3)
│   ├── waiting_for_global_confirm → [8b] 🆕 V4: Global Match Confirm Handler (Tier 2)
│   ├── waiting_for_price_confirm → [9] Price Confirm Handler (Flow 3)
│   └── waiting_for_custom_price → [10] Custom Price Handler (Flow 3)
├── [11] Invoice Processing Pipeline (shared by 5 & 6)
│   ├── [11a] 🆕 V4: 3-Tier Fallback Lookup + Unit Conversion
│   │   ├── Tier 1: mapping_dictionary (local tenant data)
│   │   ├── Tier 2: global_fmcg_master (shared FMCG data) → confirm via Zalo
│   │   └── Tier 3: Manual barcode scan (original Flow 2)
│   ├── [11b] 🆕 V4: Global Match Confirmation (Tier 2 Zalo interaction)
│   ├── [11c] PO Creation → Flow 1
│   └── [11d] Price Check → Flow 3
└── [12] Error Handler (Global)
```

> **⚠️ V3 CRITICAL — ASYNC PATTERN:** Zalo retries webhooks if no HTTP response within **5 seconds**. GPT-4o-mini Vision calls take 10-30s. Therefore, we MUST use n8n's **"Respond to Webhook"** node to return HTTP 200 immediately after receiving the payload. All business logic (signature check, LLM calls, API calls) runs **asynchronously after** the webhook has already responded. This prevents Zalo duplicate retries.

```
TIMING DIAGRAM:

Zalo Server ──[POST webhook]──> n8n Node 1 (receive)
                                     │
                                n8n Node 1b: Respond to Webhook → HTTP 200 OK  (~50ms)
                                     │                              │
                                     │                   Zalo: ✅ Got 200, no retry
                                     ▼
                                Node 2: Verify Signature (async)
                                     │
                                Node 3-12: Full processing pipeline (5s - 60s)
                                     │
                                Send Zalo reply message via API (when done)
```

### 4.2 Node-by-Node Blueprint

#### NODE 1: Zalo Webhook Receiver
- **Type:** Webhook (POST)
- **Path:** `/webhook/zalo-oa`
- **Response Mode:** ⚠️ V3: Set to **"Using 'Respond to Webhook' Node"** (NOT "Immediately" or "When Last Node Finishes")
- **Output:** Raw Zalo payload JSON

#### NODE 1b: Respond to Webhook ⚠️ V3 NEW
- **Type:** Respond to Webhook
- **Position:** Immediately after Node 1, BEFORE any processing
- **Response Code:** `200`
- **Response Body:** `{"status": "received"}` (Zalo doesn't care about body, just needs 200)

> **Why this matters:** Without this node, n8n waits for the ENTIRE workflow to finish before responding. A single LLM Vision call (10-30s) will cause Zalo to retry 2-3 times, creating duplicate Purchase Orders. This is a **production-breaking bug** if not handled.

#### NODE 2: Signature Verification (Code Node) — ⚠️ V3: Now runs ASYNC after 200 response
```javascript
// Verify Zalo OA Webhook Signature
// ⚠️ V3: This runs AFTER we've already returned HTTP 200 to Zalo.
// If signature fails, we silently drop the request (no retry loop).
const crypto = require('crypto');

const OA_SECRET_KEY = $env.ZALO_OA_SECRET;
const timestamp = $input.item.json.timestamp;
const payload = JSON.stringify($input.item.json);

// Zalo signs: SHA256(app_id + timestamp + payload + OA_SECRET)
const dataToSign = `${$input.item.json.app_id}${timestamp}${payload}${OA_SECRET_KEY}`;
const expectedSignature = crypto.createHash('sha256').update(dataToSign).digest('hex');

const receivedSignature = $input.item.json.mac; // Zalo sends 'mac' field

if (receivedSignature !== expectedSignature) {
  // ⚠️ V3: Don't throw — we already returned 200. Log and stop silently.
  console.error('INVALID_SIGNATURE: Dropping forged request from', $input.item.json.sender?.id);
  return []; // Return empty to stop workflow execution on this branch
}

return $input.item;
```

#### NODE 3: Session State Router (Code + Switch)
```javascript
// Lookup user session state from DB
const zaloUserId = $input.item.json.sender.id;

// Query PostgreSQL / Google Sheets for current session
const session = await queryDB(
  `SELECT session_state, context_data, pending_invoice 
   FROM user_sessions 
   WHERE zalo_user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
  [zaloUserId]
);

const currentState = session?.session_state || 'idle';

return {
  json: {
    ...$input.item.json,
    _session: {
      state: currentState,
      context: session?.context_data || {},
      pending_invoice: session?.pending_invoice || null
    }
  }
};
```

**Switch Node branches:**
- `idle` → Message Type Router
- `waiting_for_barcode` → Barcode Handler (Tier 3)
- `waiting_for_global_confirm` → 🆕 V4: Global Match Confirm Handler (Tier 2)
- `waiting_for_price_confirm` → Price Confirm Handler
- `waiting_for_custom_price` → Custom Price Handler

#### NODE 4: Message Type Router (Switch)
Routes based on `event_name`:
- `user_send_file` AND attachment type contains "xml" → XML Parser
- `user_send_image` → LLM Vision Flow
- `user_send_text` → Text Command Handler

#### NODE 5: XML Parser Flow (Code Node)
```javascript
const xml2js = require('xml2js');

// Download XML from Zalo URL
const fileUrl = $input.item.json.message.attachments[0].payload.url;
const xmlContent = await fetch(fileUrl).then(r => r.text());

// Parse XML to JSON
const parser = new xml2js.Parser({ explicitArray: false });
const jsonData = await parser.parseStringPromise(xmlContent);

// Extract invoice items - adapt based on XML schema from suppliers
// Common Vietnamese e-invoice XML structure (TT78 format):
const invoice = jsonData.HDon || jsonData.Invoice;
const seller = invoice.NDBan || invoice.SellerInfo;
const items = Array.isArray(invoice.DSHHDVu?.HHDVu) 
  ? invoice.DSHHDVu.HHDVu 
  : [invoice.DSHHDVu?.HHDVu].filter(Boolean);

const parsedItems = items.map((item, idx) => ({
  line_number: idx + 1,
  supplier_item_code: item.MHHDVu || item.Code || '',
  item_name: item.THHDVu || item.Name || '',
  quantity: parseFloat(item.SLuong || item.Quantity || 0),
  unit: item.DVTinh || item.Unit || '',
  unit_price: parseFloat(item.DGia || item.UnitPrice || 0),
  total_amount: parseFloat(item.ThTien || item.Amount || 0),
  is_promotion: parseFloat(item.DGia || item.UnitPrice || 0) === 0,
  barcode: item.MaSo || item.Barcode || null,
  confidence_score: 100  // XML is always 100% confidence
}));

return {
  json: {
    supplier_name: seller.Ten || seller.Name || 'UNKNOWN',
    invoice_number: invoice.SHDon || invoice.InvNum || null,
    invoice_date: invoice.NLap || invoice.InvDate || new Date().toISOString(),
    items: parsedItems,
    total_bill_amount: parseFloat(invoice.TToan?.TgTTTBSo || 0),
    raw_source: 'xml',
    llm_overall_confidence: 100
  }
};
```

#### NODE 6: LLM Vision Flow (HTTP Request + Code)

**Step 6a: Download image from Zalo**
```javascript
const imageUrl = $input.item.json.message.attachments[0].payload.url;
const imageBuffer = await fetch(imageUrl).then(r => r.arrayBuffer());
const base64Image = Buffer.from(imageBuffer).toString('base64');
return { json: { base64Image, originalPayload: $input.item.json } };
```

**Step 6b: Call GPT-4o-mini Vision**
- **Type:** HTTP Request Node
- **Method:** POST
- **URL:** `https://api.openai.com/v1/chat/completions`
- **Headers:** `Authorization: Bearer {{$env.OPENAI_API_KEY}}`
- **Body:**

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "You are a Vietnamese invoice/receipt OCR specialist for a grocery store (tạp hóa). Your job is to extract structured data from photos of purchase invoices (hóa đơn nhập hàng).\n\nRULES:\n1. Extract EVERY line item visible on the bill.\n2. For each item, extract: item_code (mã hàng), item_name (tên hàng), quantity (số lượng), unit (đơn vị tính), unit_price (đơn giá nhập), total_amount (thành tiền).\n3. CRITICAL - PROMOTION DETECTION: Items that are part of 'Chương trình khuyến mãi', 'KM', 'Tặng', 'Free', or have unit_price = 0 must be flagged as is_promotion: true.\n4. For each field, provide a confidence score (0-100). If text is blurry, smudged, or partially hidden, give a lower score.\n5. Extract supplier name from the bill header if visible.\n6. CRITICAL - VIETNAMESE GROCERY ABBREVIATIONS: Thermal receipt printers often use abbreviations for units. You MUST interpret these correctly:\n   - 'Th' or 'T' = Thùng (Box/Carton, typically 12-24 smaller units)\n   - 'L' = Lốc (Pack/Shrink-wrap, typically 4-6 units)\n   - 'Ch' = Chai (Bottle)\n   - 'H' = Hộp (Box/Carton for individual items)\n   - 'G' or 'Kg' = Kilogram\n   - 'K' or 'Két' = Két (Crate, typically 20-24 bottles)\n   - 'C' = Cái (Piece)\n   - 'Bao' or 'B' = Bao (Bag, for rice/sugar/flour)\n   Always output the FULL Vietnamese unit name (e.g., 'Thùng' not 'Th') in the unit field.\n7. Output ONLY valid JSON. No explanation text.\n\nOUTPUT FORMAT:\n```json\n{\n  \"supplier_name\": \"string\",\n  \"invoice_number\": \"string or null\",\n  \"invoice_date\": \"YYYY-MM-DD or null\",\n  \"items\": [\n    {\n      \"line_number\": 1,\n      \"supplier_item_code\": \"string\",\n      \"item_name\": \"string\",\n      \"quantity\": number,\n      \"unit\": \"string\",\n      \"unit_price\": number,\n      \"total_amount\": number,\n      \"is_promotion\": boolean,\n      \"barcode\": \"string or null\",\n      \"confidence_score\": number\n    }\n  ],\n  \"total_bill_amount\": number,\n  \"overall_confidence\": number\n}\n```"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,{{$json.base64Image}}",
            "detail": "high"
          }
        },
        {
          "type": "text",
          "text": "Đọc và trích xuất toàn bộ dữ liệu từ hóa đơn nhập hàng này. Chú ý phân biệt hàng mua và hàng khuyến mãi/tặng."
        }
      ]
    }
  ],
  "max_tokens": 4000,
  "temperature": 0.1
}
```

**Step 6c: Parse LLM Response + Confidence Gate (Code Node)**
```javascript
const llmResponse = $input.item.json.choices[0].message.content;

// Clean response (remove markdown code fences if present)
const cleaned = llmResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const parsed = JSON.parse(cleaned);

// CONFIDENCE GATE
const overallConfidence = parsed.overall_confidence || 0;
const lowConfidenceItems = parsed.items.filter(i => i.confidence_score < 70);

return {
  json: {
    ...parsed,
    raw_source: 'image',
    llm_overall_confidence: overallConfidence,
    _has_low_confidence: overallConfidence < 70 || lowConfidenceItems.length > 0,
    _low_confidence_items: lowConfidenceItems
  }
};
```

#### NODE 7: Text Command Handler
Handles text inputs based on session state:
- Barcode numbers (when `waiting_for_barcode`)
- Price values (when `waiting_for_custom_price`)
- General commands: "sync", "help", "status"

#### NODE 11: Invoice Processing Pipeline

**Step 11a: 🆕 V4 — 3-Tier Fallback Lookup + ⚠️ V3 Unit Conversion (Code + DB Query)**

> **🆕 V4 ARCHITECTURE CHANGE:** The old V3 lookup was a simple 2-step process (found in mapping → or ask for barcode). V4 introduces a 3-tier fallback that dramatically reduces manual input, especially for new tenants with empty `mapping_dictionary`.

```javascript
const invoice = $input.item.json; // ParsedInvoice
const results = { mapped: [], unmapped_tier2: [], unmapped_tier3: [], promotions: [] };

for (const item of invoice.items) {
  // 0. Separate promotions (still need mapping for inventory tracking)
  if (item.is_promotion) {
    item.unit_price = 0;
    item.total_amount = 0;
    results.promotions.push(item);
  }

  // ═══════════════════════════════════════════════════════
  // TIER 1: Local mapping_dictionary (tenant's own data)
  // This is the fastest path — items the tenant has seen before.
  // ═══════════════════════════════════════════════════════
  let mapping = null;

  // 1a. Try barcode match first (most reliable)
  if (item.barcode) {
    mapping = await queryDB(
      `SELECT * FROM mapping_dictionary WHERE barcode = $1 AND is_active = TRUE`,
      [item.barcode]
    );
  }

  // 1b. Try supplier + item code
  if (!mapping) {
    mapping = await queryDB(
      `SELECT * FROM mapping_dictionary 
       WHERE supplier_code = $1 AND supplier_item_code = $2 AND is_active = TRUE`,
      [invoice.supplier_name, item.supplier_item_code]
    );
  }

  // 1c. Fuzzy match on product name in local cache
  if (!mapping) {
    mapping = await queryDB(
      `SELECT md.* FROM mapping_dictionary md
       JOIN kiotviet_product_cache kpc ON md.kiotviet_product_id = kpc.kiotviet_product_id
       WHERE kpc.product_name ILIKE $1 AND md.is_active = TRUE
       LIMIT 1`,
      [`%${item.item_name}%`]
    );
  }

  // TIER 1 HIT → Apply V3 unit conversion and add to mapped
  if (mapping) {
    const conversionRate = mapping.conversion_rate || 1;
    const converted = {
      ...item,
      _mapping: mapping,
      _match_tier: 1,  // 🆕 V4: Track which tier matched
      _conversion_rate: conversionRate,
      _original_quantity: item.quantity,
      _original_unit_price: item.unit_price,
      _original_unit: item.unit,
      quantity: item.quantity * conversionRate,
      unit_price: item.unit_price / conversionRate,
      unit: mapping.pos_unit || item.unit,
    };
    results.mapped.push(converted);
    continue; // ✅ Done with this item
  }

  // ═══════════════════════════════════════════════════════
  // TIER 2 (🆕 V4): Global FMCG Master Database
  // Search shared product database by fuzzy name match.
  // If found, suggest to user for confirmation (NOT auto-create).
  // ═══════════════════════════════════════════════════════
  let globalMatch = null;

  // 2a. If item has a barcode, try exact barcode match in global DB
  if (item.barcode) {
    globalMatch = await queryDB(
      `SELECT * FROM global_fmcg_master WHERE barcode = $1`,
      [item.barcode]
    );
  }

  // 2b. Fuzzy name match using PostgreSQL full-text search
  if (!globalMatch) {
    // Split item_name into search tokens, match against standard_name
    const searchTerms = item.item_name
      .replace(/[^a-zA-ZÀ-ỹ0-9\s]/g, '')  // Remove special chars
      .split(/\s+/)
      .filter(t => t.length > 1)             // Skip single chars
      .join(' & ');                           // AND logic for tsquery

    if (searchTerms) {
      globalMatch = await queryDB(
        `SELECT *, 
                ts_rank(to_tsvector('simple', standard_name), to_tsquery('simple', $1)) AS rank
         FROM global_fmcg_master
         WHERE to_tsvector('simple', standard_name) @@ to_tsquery('simple', $1)
         ORDER BY rank DESC
         LIMIT 1`,
        [searchTerms]
      );
    }
  }

  // 2c. Brand + category heuristic (last resort for Tier 2)
  if (!globalMatch && item.item_name) {
    // Try matching just the first 2 significant words (often brand + product type)
    const keywords = item.item_name.split(/\s+/).slice(0, 3).join('%');
    globalMatch = await queryDB(
      `SELECT * FROM global_fmcg_master
       WHERE standard_name ILIKE $1
       LIMIT 1`,
      [`%${keywords}%`]
    );
  }

  // TIER 2 HIT → Queue for user confirmation via Zalo
  if (globalMatch) {
    results.unmapped_tier2.push({
      ...item,
      _match_tier: 2,
      _global_match: {
        barcode: globalMatch.barcode,
        standard_name: globalMatch.standard_name,
        brand: globalMatch.brand,
        category: globalMatch.category,
        supplier_unit: globalMatch.supplier_unit,
        pos_unit: globalMatch.pos_unit,
        default_conversion_rate: globalMatch.default_conversion_rate
      }
    });
    continue; // → Goes to Node 11b for Zalo confirmation
  }

  // ═══════════════════════════════════════════════════════
  // TIER 3: No match anywhere → Manual barcode scan
  // This is the original Flow 2 from V1/V3.
  // ═══════════════════════════════════════════════════════
  results.unmapped_tier3.push({
    ...item,
    _match_tier: 3
  });
}

return { json: results };
```

> **⚠️ V3 Unit Conversion Example (still applies for Tier 1):**
> ```
> Bill says:     2 Thùng Bia Tiger  @ 240,000đ/Thùng = 480,000đ
> conversion_rate = 24 (1 Thùng = 24 Lon)
> KiotViet PO:   48 Lon Bia Tiger   @ 10,000đ/Lon    = 480,000đ  ✅ Total unchanged
> ```
> This is critical because KiotViet calculates inventory in retail units (Lon). If we pass "2 Thùng" directly, the inventory count will be wrong (showing 2 instead of 48).

> **🆕 V4 3-Tier Flow Diagram:**
> ```
> Item from invoice
>       │
>   ┌───▼───┐     YES    ┌─────────────────────────────┐
>   │Tier 1 │ ──────────>│ Apply unit conversion → PO  │
>   │Local  │            └─────────────────────────────┘
>   └───┬───┘
>       │ NO
>   ┌───▼───┐     YES    ┌─────────────────────────────┐
>   │Tier 2 │ ──────────>│ Ask user: "Is this [name]?" │
>   │Global │            │ [✅ Đúng] → auto-create      │
>   │FMCG   │            │ [❌ Không] → fall to Tier 3  │
>   └───┬───┘            └─────────────────────────────┘
>       │ NO
>   ┌───▼───┐            ┌─────────────────────────────┐
>   │Tier 3 │ ──────────>│ "Scan barcode" (original)   │
>   │Manual │            └─────────────────────────────┘
>   └───────┘
> ```

**Step 11b: 🆕 V4 — Global Match Confirmation (Tier 2 Zalo Interaction)**

When `results.unmapped_tier2.length > 0`, the bot sends a confirmation message for EACH unmatched item that has a global_fmcg_master suggestion. The bot does NOT ask for a barcode — it already has one from the global database.

```javascript
// Process Tier 2 items: ask user to confirm global match
const tier2Items = $input.item.json.unmapped_tier2;

if (tier2Items.length > 0) {
  // Process one item at a time to avoid overwhelming the user
  const currentItem = tier2Items[0];
  const match = currentItem._global_match;
  const remainingItems = tier2Items.slice(1);

  // 1. Save session state
  await queryDB(
    `UPDATE user_sessions SET
       session_state = 'waiting_for_global_confirm',
       context_data = $1,
       pending_invoice = $2,
       expires_at = NOW() + INTERVAL '30 minutes',
       updated_at = NOW()
     WHERE zalo_user_id = $3`,
    [
      JSON.stringify({
        pending_item: currentItem,
        global_match: match,
        remaining_tier2: remainingItems,
        remaining_tier3: $input.item.json.unmapped_tier3 || [],
        mapped_so_far: $input.item.json.mapped || []
      }),
      JSON.stringify($input.item.json._pending_invoice),
      zaloUserId
    ]
  );

  // 2. Send Zalo confirmation message with inline buttons
  const convInfo = match.default_conversion_rate > 1
    ? ` (1 ${match.supplier_unit} = ${match.default_conversion_rate} ${match.pos_unit})`
    : '';

  const zaloMessage = {
    recipient: { user_id: zaloUserId },
    message: {
      text: `Sếp ơi, em thấy món mới trên bill nè! 🔍\n\n` +
            `📋 Bill ghi: "${currentItem.item_name}"\n` +
            `📦 Số lượng: ${currentItem.quantity} ${currentItem.unit}\n` +
            `💰 Giá nhập: ${currentItem.unit_price.toLocaleString('vi-VN')}đ\n\n` +
            `🏷️ Em tra dữ liệu thì có phải là:\n` +
            `👉 **${match.standard_name}**${convInfo}\n` +
            `📊 Mã vạch: ${match.barcode}\n\n` +
            `Đúng không sếp?`,
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          buttons: [
            {
              title: "✅ Đúng, tạo mã",
              type: "oa.query",
              payload: `GLOBAL_CONFIRM|${match.barcode}|${match.default_conversion_rate}`
            },
            {
              title: "❌ Không phải",
              type: "oa.query",
              payload: "GLOBAL_REJECT"
            }
          ]
        }
      }
    }
  };

  return { json: zaloMessage };
}
```

**Step 11b-handler: 🆕 V4 — Global Confirm/Reject Button Handler (NODE 8b)**

This node handles the user's response to the Tier 2 confirmation message. It is triggered when `session_state = 'waiting_for_global_confirm'`.

```javascript
const payload = $input.item.json.message.text; // e.g., "GLOBAL_CONFIRM|8934588012099|24"
const session = $input.item.json._session;
const ctx = session.context;

if (payload.startsWith('GLOBAL_CONFIRM')) {
  // ═══ USER CONFIRMED: Auto-create product + mapping ═══
  const [action, barcode, conversionRate] = payload.split('|');
  const match = ctx.global_match;
  const pendingItem = ctx.pending_item;

  // 1. Create product on KiotViet (POST /products)
  const newProduct = await createKiotVietProduct({
    name: match.standard_name,
    barCode: barcode,
    cost: pendingItem.unit_price,
    basePrice: 0,
    unit: match.pos_unit || pendingItem.unit,
    categoryName: match.category
  });

  // 2. Auto-create mapping_dictionary entry (system LEARNS)
  await queryDB(
    `INSERT INTO mapping_dictionary 
     (supplier_code, supplier_item_code, supplier_item_name, 
      kiotviet_product_id, kiotviet_product_code, kiotviet_product_name,
      barcode, supplier_unit, pos_unit, conversion_rate, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'global_fmcg')`,
    [
      ctx._pending_invoice?.supplier_name || 'UNKNOWN',
      pendingItem.supplier_item_code,
      pendingItem.item_name,
      newProduct.id,
      newProduct.code,
      match.standard_name,
      barcode,
      match.supplier_unit,
      match.pos_unit,
      parseInt(conversionRate) || match.default_conversion_rate || 1
    ]
  );

  // 3. Apply unit conversion (V3 logic) and add to mapped items
  const rate = parseInt(conversionRate) || 1;
  const convertedItem = {
    ...pendingItem,
    _mapping: { kiotviet_product_id: newProduct.id, kiotviet_product_code: newProduct.code,
                conversion_rate: rate, pos_unit: match.pos_unit },
    _match_tier: 2,
    _conversion_rate: rate,
    _original_quantity: pendingItem.quantity,
    _original_unit_price: pendingItem.unit_price,
    quantity: pendingItem.quantity * rate,
    unit_price: pendingItem.unit_price / rate,
    unit: match.pos_unit || pendingItem.unit
  };

  ctx.mapped_so_far.push(convertedItem);

  // 4. Process next unmapped item (if any remain)
  return processNextUnmappedItem(ctx, zaloUserId);

} else if (payload === 'GLOBAL_REJECT') {
  // ═══ USER REJECTED: Fall through to Tier 3 (manual barcode scan) ═══
  const pendingItem = ctx.pending_item;

  // Move this item from Tier 2 to Tier 3
  ctx.remaining_tier3.push({ ...pendingItem, _match_tier: 3 });

  // Process next unmapped item
  return processNextUnmappedItem(ctx, zaloUserId);
}

// ─── Helper: Process next item in the queue ───
async function processNextUnmappedItem(ctx, userId) {
  // Check if more Tier 2 items remain
  if (ctx.remaining_tier2.length > 0) {
    const nextItem = ctx.remaining_tier2.shift();
    // Update session and send next Tier 2 confirmation message
    // (same logic as Step 11b above)
    return sendTier2Confirmation(nextItem, ctx, userId);
  }

  // Check if Tier 3 items remain
  if (ctx.remaining_tier3.length > 0) {
    const nextItem = ctx.remaining_tier3.shift();
    // Switch to Tier 3: ask for barcode scan (original Flow 2)
    await updateSession(userId, 'waiting_for_barcode', {
      pending_item: nextItem,
      remaining_tier3: ctx.remaining_tier3,
      mapped_so_far: ctx.mapped_so_far
    });
    return sendBarcodeRequest(nextItem, userId);
  }

  // All items mapped! Continue to PO creation (Step 11c)
  await updateSession(userId, 'idle', {});
  return { json: { _action: 'create_po', items: ctx.mapped_so_far } };
}
```

**Step 11c: PO Creation (HTTP Request)**
When all items are mapped, build and send `POST /purchaseorders` payload (see Section 3.3).

**Step 11d: Price Check Flow — ⚠️ V3: Uses converted unit_price (post-conversion_rate)**
```javascript
// After PO is created, check each item for price changes
// ⚠️ V3: item.unit_price is ALREADY converted (e.g., 10,000đ/Lon, not 240,000đ/Thùng)
const priceAlerts = [];

for (const item of mappedItems) {
  const cachedProduct = await queryDB(
    `SELECT * FROM kiotviet_product_cache WHERE kiotviet_product_id = $1`,
    [item._mapping.kiotviet_product_id]
  );

  const oldCost = cachedProduct?.cost || 0;
  const newCost = item.unit_price;

  if (oldCost > 0 && newCost !== oldCost) {
    // Lookup pricing rule
    const rule = await queryDB(
      `SELECT * FROM pricing_rules 
       WHERE (rule_type = 'product' AND rule_key = $1)
          OR (rule_type = 'category' AND rule_key = $2)
          OR (rule_type = 'category' AND rule_key = 'DEFAULT')
       ORDER BY priority DESC LIMIT 1`,
      [cachedProduct.product_code, cachedProduct.category_name]
    );

    const marginPercent = rule?.margin_percent || 15;
    const suggestedPrice = newCost * (1 + marginPercent / 100);
    const currentSellingPrice = cachedProduct.base_price;

    const expectedMinPrice = newCost * (1 + marginPercent / 100);

    if (currentSellingPrice < expectedMinPrice) {
      priceAlerts.push({
        product_id: cachedProduct.kiotviet_product_id,
        product_name: cachedProduct.product_name,
        old_cost: oldCost,
        new_cost: newCost,
        current_selling_price: currentSellingPrice,
        suggested_price: Math.round(suggestedPrice), // Round to nearest đồng
        margin_percent: marginPercent
      });
    }
  }
}

return { json: { alerts: priceAlerts } };
```

#### NODE 8: Barcode Handler (Flow 2 Continuation — Tier 3)

```javascript
// User scanned barcode and sent the number as text
const barcodeText = $input.item.json.message.text.trim();
const session = $input.item.json._session;
const pendingItem = session.context.pending_item;

// Validate: barcode should be numeric, 8-13 digits
if (!/^\d{8,13}$/.test(barcodeText)) {
  // Send error message, ask again
  return { json: { _action: 'ask_barcode_again', message: 'Mã vạch không hợp lệ, sếp gửi lại nhé!' } };
}

// Create product on KiotViet
const newProductPayload = {
  name: pendingItem.name,
  barCode: barcodeText,
  cost: pendingItem.cost,
  basePrice: 0,
  unit: pendingItem.unit || 'Cái',
  allowsSale: true
};

// After product creation:
// 1. Save to mapping_dictionary
// 2. Save to product_cache
// 3. Update session: remove this item from unmapped list
// 4. If more unmapped items → ask for next barcode
// 5. If all mapped → continue to PO creation (Step 11c)
```

#### NODE 9 & 10: Price Confirmation Handlers

**Zalo Message with Inline Buttons (sent by bot):**
```json
{
  "recipient": { "user_id": "user_zalo_id_abc123" },
  "message": {
    "text": "Sếp ơi, giá vốn vừa thay đổi nè! 🚨\n📦 Kem Merino Socola: Giá nhập tăng từ 10.000đ ➡️ 12.000đ.\n💰 Giá bán hiện tại: 14.000đ (Thấp hơn mức lãi kỳ vọng).\n✨ Đề xuất giá mới (Lãi 20%): 14.400đ.\nSếp muốn tính sao?",
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "button",
        "buttons": [
          {
            "title": "✅ Cập nhật 14.400đ",
            "type": "oa.query",
            "payload": "PRICE_CONFIRM|12345|14400"
          },
          {
            "title": "🔒 Giữ nguyên 14.000đ",
            "type": "oa.query",
            "payload": "PRICE_KEEP|12345"
          },
          {
            "title": "✏️ Nhập giá khác",
            "type": "oa.query",
            "payload": "PRICE_CUSTOM|12345"
          }
        ]
      }
    }
  }
}
```

**When user clicks a button, Zalo sends back the payload string. Node 9 parses it:**
```javascript
const payload = $input.item.json.message.text; // e.g., "PRICE_CONFIRM|12345|14400"
const [action, productId, price] = payload.split('|');

switch (action) {
  case 'PRICE_CONFIRM':
    // PUT /products/{productId} with basePrice = price
    return { json: { _action: 'update_price', productId, newPrice: parseFloat(price) } };

  case 'PRICE_KEEP':
    // No action, clear session
    return { json: { _action: 'clear_session' } };

  case 'PRICE_CUSTOM':
    // Set session to waiting_for_custom_price
    return { json: { _action: 'ask_custom_price', productId } };
}
```

### 4.3 Global Error Handler (NODE 12)

```javascript
// Catches all unhandled errors in the workflow
const error = $input.item.json._error || $input.item.json.error;

// Log to invoice_log table
await queryDB(
  `INSERT INTO invoice_log (zalo_user_id, status, error_details, created_at)
   VALUES ($1, 'failed', $2, NOW())`,
  [$input.item.json.sender?.id || 'unknown', JSON.stringify(error)]
);

// Notify user via Zalo
const errorMessage = {
  recipient: { user_id: $input.item.json.sender?.id },
  message: {
    text: `Sếp ơi, em gặp trục trặc rồi 😢\nLỗi: ${error?.message || 'Không xác định'}\nSếp thử gửi lại hoặc liên hệ admin nhé!`
  }
};

return { json: errorMessage };
```

---

## 5. STEP-BY-STEP VIBECODING PLAN

### Phase 0: Project Scaffolding & Environment Setup
**Goal:** Get the local dev environment ready.  
**Deliverables:**
- [ ] n8n instance running (self-hosted Docker or n8n Cloud)
- [ ] PostgreSQL database created with all tables from Section 2.1 (including 🆕 `global_fmcg_master`)
- [ ] Zalo OA Developer account + webhook URL configured
- [ ] KiotViet API credentials (Client ID, Client Secret, Retailer name)
- [ ] OpenAI API key with GPT-4o-mini access
- [ ] Environment variables configured in n8n:
  - `ZALO_OA_SECRET`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_APP_ID`
  - `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER`
  - `OPENAI_API_KEY`
  - `DATABASE_URL` (PostgreSQL connection string)
- [ ] ngrok or public URL for n8n webhook (dev only)

**Test:** Can you ping the n8n webhook URL and get a 200 response?

---

### Phase 0.5: Zalo Token Lifecycle Management ⚠️ V3 NEW — CRITICAL
**Goal:** Prevent the "token expiration bomb" — Zalo OA Access Tokens expire in exactly 25 hours. Without auto-refresh, ALL Zalo messaging dies silently.  
**n8n Nodes to Build (Separate Workflow: "Zalo Token Refresh"):**
1. **Schedule Trigger** → Runs every **20 hours** (5-hour safety buffer before 25h expiry)
2. **PostgreSQL Node** → Read current `refresh_token` from `zalo_token_store` WHERE `is_active = TRUE`
3. **HTTP Request Node** → Call Zalo OAuth Refresh endpoint:
   ```
   POST https://oauth.zaloapp.com/v4/oa/access_token
   Content-Type: application/x-www-form-urlencoded

   refresh_token={CURRENT_REFRESH_TOKEN}
   app_id={ZALO_APP_ID}
   grant_type=refresh_token
   ```
   Response:
   ```json
   {
     "access_token": "NEW_ACCESS_TOKEN_abc...",
     "refresh_token": "NEW_REFRESH_TOKEN_xyz...",
     "expires_in": "90000"
   }
   ```
4. **Code Node** → Validate response (check for error codes)
5. **PostgreSQL Node** → Transaction:
   - Set old token `is_active = FALSE`
   - INSERT new row with new `access_token`, new `refresh_token`, `expires_at = NOW() + 25 hours`
6. **n8n Set Node** → Update the global static variable / credential that all other workflows use for `ZALO_OA_ACCESS_TOKEN`
7. **Error Branch** → If refresh fails (e.g., refresh token expired after 3 months of inactivity):
   - Send email/Telegram alert to admin: "🚨 Zalo token refresh failed! Manual re-auth required."
   - Log to `invoice_log` with `status = 'token_error'`

**Helper Function (used by ALL workflows that call Zalo API):**
```javascript
// getZaloAccessToken() — always call this before any Zalo API request
async function getZaloAccessToken() {
  const result = await queryDB(
    `SELECT access_token, expires_at FROM zalo_token_store 
     WHERE is_active = TRUE AND token_type = 'oa_access'
     ORDER BY created_at DESC LIMIT 1`
  );
  
  if (!result || new Date(result.expires_at) < new Date()) {
    throw new Error('E011: Zalo access token expired or missing. Check Phase 0.5 workflow.');
  }
  
  return result.access_token;
}
```

**Initial Setup (Manual, One-Time):**
1. Go to Zalo Developer Console → Your OA App → Get initial Access Token + Refresh Token
2. Insert into `zalo_token_store`:
   ```sql
   INSERT INTO zalo_token_store (token_type, access_token, refresh_token, expires_at, issued_at)
   VALUES ('oa_access', 'INITIAL_TOKEN', 'INITIAL_REFRESH', NOW() + INTERVAL '25 hours', NOW());
   ```
3. Activate the Schedule Trigger workflow

**Test:** 
- Manually trigger the refresh workflow. Verify new token is saved to DB.
- Wait 20 hours (or temporarily set schedule to 2 minutes for testing). Verify auto-refresh fires.
- Call a Zalo API with the new token. Verify it works.

---

### Phase 1: KiotViet Auth + Product Sync
**Goal:** Authenticate with KiotViet and build the local product cache.  
**n8n Nodes to Build:**
1. Manual Trigger → HTTP Request (POST token endpoint) → Store token
2. Loop: GET /products (paginated) → Code Node (transform) → PostgreSQL Insert (upsert to `kiotviet_product_cache`)
3. Schedule Trigger (every 6 hours) → re-run sync

**Test:** Run workflow. Verify `kiotviet_product_cache` table has all products with correct barcode, price, cost, category.

---

### Phase 1.5: Seed Global Master Data 🆕 V4 — COLD START PREREQUISITE
**Goal:** Populate the `global_fmcg_master` table with common Vietnamese FMCG products so the 3-Tier Fallback Lookup (Node 11a) has data to match against.  
**Type:** Database ops task (NO n8n workflow needed for MVP).

**Steps:**
1. **Source the Data:**
   - Curate a CSV/Excel file of common Vietnamese grocery products. Target: 500-1,000 products for MVP, scaling to 50,000.
   - Data columns: `barcode`, `standard_name`, `brand`, `category`, `supplier_unit`, `pos_unit`, `default_conversion_rate`
   - Sources: GS1 Vietnam barcode registry, distributor product catalogs (Unilever, P&G, Masan, Vinamilk), manual entry from existing KiotViet stores.

2. **Prepare the CSV:**
   ```csv
   barcode,standard_name,brand,category,supplier_unit,pos_unit,default_conversion_rate
   8934588012099,Bia Tiger Lon 330ml,Tiger,Bia,Thùng,Lon,24
   8935049500308,Coca-Cola Lon 330ml,Coca-Cola,Nước ngọt,Thùng,Lon,24
   8934673583220,Sữa Vinamilk Không Đường 180ml,Vinamilk,Sữa,Lốc,Hộp,4
   8936136160126,Mì Hảo Hảo Tôm Chua Cay 75g,Hảo Hảo,Mì gói,Thùng,Gói,30
   ```

3. **Import to PostgreSQL:**
   ```bash
   # Option A: psql COPY command (fastest)
   psql $DATABASE_URL -c "\COPY global_fmcg_master(barcode, standard_name, brand, category, supplier_unit, pos_unit, default_conversion_rate) FROM '/path/to/fmcg_data.csv' WITH CSV HEADER"

   # Option B: Use DBeaver / pgAdmin GUI import
   ```

4. **Validate:**
   ```sql
   SELECT COUNT(*) FROM global_fmcg_master;  -- Should be > 500
   SELECT category, COUNT(*) FROM global_fmcg_master GROUP BY category ORDER BY count DESC;
   -- Verify spread across categories: Bia, Nước ngọt, Sữa, Mì gói, Gia vị, etc.
   ```

**Test:**
- Run a sample fuzzy search: `SELECT * FROM global_fmcg_master WHERE standard_name ILIKE '%tiger%lon%';`
- Verify it returns "Bia Tiger Lon 330ml" with correct conversion_rate = 24.
- Run full-text search: `SELECT * FROM global_fmcg_master WHERE to_tsvector('simple', standard_name) @@ to_tsquery('simple', 'bia & tiger');`

> **🆕 V4 NOTE:** This is a one-time seed for MVP. In production SaaS, this table would be maintained by a dedicated data team and updated monthly with new products from distributors. Tenants cannot write to this table — it is platform-level shared data.

---

### Phase 2: Zalo Webhook + Signature Verification
**Goal:** Receive and validate Zalo messages with the ⚠️ V3 async pattern.  
**n8n Nodes to Build:**
1. Webhook Node (POST `/webhook/zalo-oa`) — Response Mode: **"Using Respond to Webhook Node"**
2. **Respond to Webhook Node** → Returns HTTP 200 immediately (⚠️ V3 CRITICAL: before any processing)
3. Code Node: Signature verification — runs async AFTER 200 response (Section 4.2, Node 2)
4. Code Node: Log raw payload to console/file for debugging
5. HTTP Request: Send test reply back to Zalo (`POST https://openapi.zalo.me/v3.0/oa/message/cs`) — use `getZaloAccessToken()` from Phase 0.5

**Test:** Send a text message to Zalo OA. Verify:
- n8n receives webhook and responds 200 within 1 second
- Signature is validated asynchronously  
- Bot replies: "Sếp ơi, em nhận được tin nhắn rồi!"
- **Bonus test:** Disable the "Respond to Webhook" node temporarily. Observe Zalo retrying 2-3 times (proves the fix is necessary).

---

### Phase 3: XML Invoice Parser (Flow 1 - Happy Path)
**Goal:** Process XML invoices end-to-end.  
**n8n Nodes to Build:**
1. File detection branch in Message Type Router
2. XML download + parse (Node 5 from Section 4.2)
3. Mapping lookup against `mapping_dictionary` (Node 11a — Tier 1 only for this phase)
4. PO creation via `POST /purchaseorders` (Node 11c)
5. Success reply to Zalo

**Test:** Send a sample XML e-invoice via Zalo. Verify:
- Items are correctly parsed
- Mapped items generate a completed PO on KiotViet
- Promo items have cost = 0
- ⚠️ V3: Unit conversion works — if bill says "2 Thùng @ 240,000đ" and conversion_rate=24, KiotViet PO shows "48 Lon @ 10,000đ"
- Zalo reply confirms: "Em đã tạo phiếu nhập hàng #{PO_CODE} thành công!"

---

### Phase 4: LLM Vision - Image Invoice Parser
**Goal:** Process photo invoices using GPT-4o-mini Vision.  
**n8n Nodes to Build:**
1. Image detection branch
2. Image download + base64 encode (Node 6a)
3. OpenAI API call with vision prompt (Node 6b)
4. Response parser + confidence gate (Node 6c)
5. Branch: confidence ≥ 70% → continue to mapping (reuse Phase 3 pipeline)
6. Branch: confidence < 70% → Draft PO creation (Flow 4) + Zalo notification

**Test:** Send a clear photo of a receipt via Zalo. Verify extraction accuracy. Then send a blurry/partial photo and verify it creates a Draft PO.

---

### Phase 5: Session Management + New Product Flow (Flow 2) — 🆕 V4: Now with 3-Tier Fallback
**Goal:** Handle multi-step conversations for unmapped products using the 3-Tier Fallback system.  
**n8n Nodes to Build:**
1. Session State Router (Node 3) — now includes `waiting_for_global_confirm` state
2. DB operations for `user_sessions` (create, update, read, expire)
3. 🆕 V4 Tier 2: Global FMCG match detection in Node 11a → Zalo confirmation message with inline buttons
4. 🆕 V4 Tier 2 Handler (Node 8b): Process `GLOBAL_CONFIRM` / `GLOBAL_REJECT` button payloads
5. On `GLOBAL_CONFIRM`: Auto-create product on KiotViet + save mapping_dictionary with `source = 'global_fmcg'`
6. On `GLOBAL_REJECT`: Fall through to Tier 3 (manual barcode scan)
7. Tier 3 (original Flow 2): Unmapped item detection → Zalo message asking for barcode
8. Barcode text handler (Node 8)
9. ⚠️ V3: After barcode, ask for conversion_rate: "Sếp ơi, 1 [supplier_unit] [Product Name] có bao nhiêu [pos_unit] vậy ạ? (VD: 1 Thùng = 24 Lon)"
10. `POST /products` to create new product on KiotViet
11. Save to `mapping_dictionary` (including `conversion_rate`, `supplier_unit`, `pos_unit`)
12. Resume invoice processing after all items mapped

**Test Scenario A — Tier 2 Happy Path (Cold Start):**
- Start with an EMPTY `mapping_dictionary` (simulates new tenant)
- Send an invoice containing "Bia Tiger Th" (thermal receipt abbreviation)
- Bot should find "Bia Tiger Lon 330ml" in `global_fmcg_master` and ask: "Có phải là Bia Tiger Lon 330ml (1 Thùng = 24 Lon) không?"
- Click "✅ Đúng" → product created, mapping saved with `source = 'global_fmcg'`, PO completed
- Send the SAME invoice again → should now hit Tier 1 directly (no confirmation needed)

**Test Scenario B — Tier 2 Rejection → Tier 3 Fallback:**
- Send an invoice with a local/obscure product not in `global_fmcg_master`
- Bot finds no Tier 2 match → asks for barcode scan (Tier 3)
- Scan barcode → bot asks for conversion rate → product created

**Test Scenario C — Mixed (Tier 1 + Tier 2 + Tier 3 in same invoice):**
- Send invoice with 3 items: one known (Tier 1), one in global DB (Tier 2), one unknown (Tier 3)
- Verify all 3 are processed correctly in sequence, and the final PO contains all items

---

### Phase 6: Smart Pricing Alert (Flow 3)
**Goal:** Detect cost changes and suggest price updates.  
**n8n Nodes to Build:**
1. Post-PO price comparison logic (Node 11d)
2. Pricing rules lookup from `pricing_rules` table
3. Zalo message with inline buttons
4. Button payload handler (Node 9)
5. Custom price text handler (Node 10)
6. `PUT /products/{id}` to update selling price

**Test:** Manually change a product's cost in a test invoice. Verify:
- Price alert message appears with correct calculations
- "Cập nhật" button updates KiotViet selling price
- "Giữ nguyên" button does nothing
- "Nhập giá khác" allows custom price entry

---

### Phase 7: Error Handling, Edge Cases & Hardening
**Goal:** Make the system production-ready.  
**Tasks:**
1. Global error handler node (Node 12)
2. Session TTL cleanup (cron: delete sessions older than 30 min)
3. KiotViet token auto-refresh (check expiry before each API call)
4. ⚠️ V3: Verify Phase 0.5 (Zalo token refresh) is running reliably — add health check
5. Retry logic for API failures (n8n retry on error, max 3 attempts)
6. Rate limiting awareness (KiotViet: 300 requests/5 min)
7. Duplicate invoice detection (hash invoice content OR dedup by Zalo `msg_id`, check `invoice_log`)
8. ⚠️ V3: Webhook dedup guard — check `msg_id` at the start of Node 2 to catch any Zalo retries that slipped through
9. Zalo OA message character limits handling (max 2000 chars per message)
10. Multi-image handling (user sends multiple photos in one message)
11. 🆕 V4: Validate `global_fmcg_master` data quality — detect duplicate barcodes, empty standard_names

**Test:** Simulate failures — invalid XML, API timeout, duplicate invoice, expired token. Verify graceful handling for each.

---

### Phase 8: Monitoring, Logging & Deployment
**Goal:** Ship to production.  
**Tasks:**
1. Structured logging for all workflows (write to `invoice_log`)
2. Daily summary message to Sếp: "Hôm nay em xử lý X phiếu, tạo Y sản phẩm mới, cập nhật Z giá"
3. 🆕 V4: Track Tier hit rates in daily summary: "Tier 1: X items | Tier 2 (global): Y items | Tier 3 (manual): Z items" — useful for measuring cold start improvement
4. n8n workflow versioning and backup
5. PostgreSQL backup schedule
6. Production n8n deployment (VPS or n8n Cloud)
7. SSL/HTTPS for webhook endpoint
8. Zalo OA webhook URL update to production domain
9. Final end-to-end testing with real invoices

---

## 6. APPENDIX: ERROR CODES & EDGE CASES

### 6.1 Error Code Reference

| Code | Meaning | Action |
|---|---|---|
| `E001` | Zalo signature verification failed | Reject request, log IP |
| `E002` | KiotViet auth token expired | Auto-refresh, retry |
| `E003` | KiotViet API rate limit (429) | Backoff 30s, retry |
| `E004` | LLM Vision returned invalid JSON | Retry once, then Draft PO |
| `E005` | LLM confidence < 70% | Create Draft PO (Flow 4) |
| `E006` | Product not found in mapping | Trigger 3-Tier Fallback (🆕 V4: Tier 2 before Tier 3) |
| `E007` | Duplicate invoice detected | Notify user, skip processing |
| `E008` | XML parse failure | Notify user, log error |
| `E009` | Zalo image URL expired/inaccessible | Ask user to resend |
| `E010` | Session timeout (30 min) | Reset to idle, notify user |
| `E011` | ⚠️ V3: Zalo access token expired/missing | Check Phase 0.5 auto-refresh workflow. Manual re-auth if refresh token also expired |
| `E012` | ⚠️ V3: Zalo refresh token expired (3 months) | MANUAL action: Re-authenticate via Zalo Developer Console, insert new tokens to DB |
| `E013` | ⚠️ V3: Unit conversion_rate = 0 or NULL | Treat as 1, log warning, alert admin to fix mapping_dictionary |
| `E014` | 🆕 V4: global_fmcg_master returned ambiguous match (multiple close results) | Show top 2 matches to user with buttons, or fall to Tier 3 |
| `E015` | 🆕 V4: global_fmcg_master is empty or unreachable | Skip Tier 2, proceed directly to Tier 3 (manual). Log alert for platform admin |

### 6.2 Edge Cases to Handle

| Scenario | Handling Strategy |
|---|---|
| ⚠️ V3: Bill has items in wholesale units (Thùng) but POS tracks retail units (Lon) | `conversion_rate` in `mapping_dictionary` auto-converts: qty * rate, price / rate. Total amount is invariant. Always verify total_amount matches after conversion |
| ⚠️ V3: New product — don't know conversion_rate yet | When creating new product (Flow 2), bot asks: "Sếp ơi, 1 Thùng [Product] có bao nhiêu Lon/Chai?" Store answer as conversion_rate |
| ⚠️ V3: Zalo token expired mid-conversation | getZaloAccessToken() throws E011. Error handler queues the pending reply and retries after Phase 0.5 workflow runs |
| ⚠️ V3: LLM reads abbreviated unit "Th" as item name, not unit | GPT-4o-mini prompt now includes Vietnamese abbreviation dictionary (Rule 6). If still wrong, user corrects via Zalo and mapping is saved |
| 🆕 V4: Brand-new tenant with empty mapping_dictionary | Tier 2 (global_fmcg_master) auto-suggests matches for ~80% of common FMCG items. Only obscure/local products fall to Tier 3 |
| 🆕 V4: Tier 2 returns wrong product (e.g., "Bia Tiger" matches "Bia Tiger Bạc" instead of "Bia Tiger Vàng") | User clicks "❌ Không phải" → falls to Tier 3. Over time, correct mappings accumulate in mapping_dictionary and Tier 1 handles future lookups |
| 🆕 V4: Same item_name matches multiple global products | Return highest-ranked full-text search result. If ts_rank scores are close (< 0.1 difference), show both options or fall to Tier 3 |
| 🆕 V4: User confirms Tier 2 match but conversion_rate is wrong | The mapping_dictionary entry has `source = 'global_fmcg'`. User can update via admin command or next invoice will trigger correction |
| Same product from different suppliers with different codes | mapping_dictionary supports multiple rows per kiotviet_product_code with different supplier_code |
| Supplier changes their item codes | Admin can update mapping_dictionary. Bot should also try barcode match first |
| User sends random unrelated message | Bot replies: "Sếp gửi bill (ảnh/XML) để em xử lý nhé! Gõ 'help' để xem hướng dẫn." |
| User sends multiple invoices rapidly | Queue-based processing: each invoice gets its own session context. Process sequentially per user |
| KiotViet product was deleted/deactivated | Catch 404 on PO creation, alert user, refresh cache |
| Bill total doesn't match sum of line items | Log discrepancy, use line item sum as source of truth, note in PO description |
| ⚠️ V3: Zalo webhook duplicate (retry due to slow response) | Dedup by `msg_id` — check `invoice_log` for existing `msg_id` before processing. The async webhook pattern (Node 1b) prevents most retries |

### 6.3 Zalo OA API Quick Reference

| Action | Method | Endpoint |
|---|---|---|
| Send text message | POST | `https://openapi.zalo.me/v3.0/oa/message/cs` |
| Send message with buttons | POST | `https://openapi.zalo.me/v3.0/oa/message/cs` (template payload) |
| Get user info | GET | `https://openapi.zalo.me/v3.0/oa/user/detail?user_id={id}` |
| Upload image/file | POST | `https://openapi.zalo.me/v2.0/oa/upload/{type}` |

**Required Headers:**
```
access_token: {ZALO_OA_ACCESS_TOKEN}
Content-Type: application/json
```

> **⚠️ V3 CRITICAL - Zalo OA Token Lifecycle:** OA Access Tokens expire in **25 hours** (NOT 90 days). You MUST run the auto-refresh workflow from Phase 0.5 (every 20 hours) or all Zalo messaging will break silently. The Refresh Token is valid for 3 months (rolling — each refresh generates a new one). See `zalo_token_store` table in Section 2.1.

---

## END OF DOCUMENT

**How to use this document:**
1. Start with **Phase 0** to set up your environment
2. **Phase 0.5** is MANDATORY before anything else — set up Zalo token auto-refresh
3. Prompt your AI IDE: *"Execute Phase 1: KiotViet Auth + Product Sync"*
4. **Phase 1.5** — Seed the `global_fmcg_master` table (🆕 V4: required before Phase 5 Tier 2 works)
5. After testing each phase, move to the next
6. Reference **Section 3** for exact API payloads when building HTTP Request nodes
7. Reference **Section 4.2** for exact node logic when building n8n workflows
8. Reference **Section 2** for database queries

Each phase is designed to be a standalone, testable unit. Do not skip phases.
