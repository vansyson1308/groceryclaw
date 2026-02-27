-- 001_init.sql
-- Initial PostgreSQL schema based on PRD v4.0.0 Section 2.1

BEGIN;

CREATE TABLE IF NOT EXISTS global_fmcg_master (
    barcode                 VARCHAR(50) PRIMARY KEY,
    standard_name           VARCHAR(500) NOT NULL,
    brand                   VARCHAR(100),
    category                VARCHAR(100),
    supplier_unit           VARCHAR(50),
    pos_unit                VARCHAR(50),
    default_conversion_rate INT DEFAULT 1,
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_fmcg_name
    ON global_fmcg_master USING gin(to_tsvector('simple', standard_name));
CREATE INDEX IF NOT EXISTS idx_global_fmcg_brand ON global_fmcg_master(brand);
CREATE INDEX IF NOT EXISTS idx_global_fmcg_category ON global_fmcg_master(category);

CREATE TABLE IF NOT EXISTS mapping_dictionary (
    id                    SERIAL PRIMARY KEY,
    supplier_code         VARCHAR(100) NOT NULL,
    supplier_item_code    VARCHAR(200) NOT NULL,
    supplier_item_name    VARCHAR(500),
    kiotviet_product_id   BIGINT NOT NULL,
    kiotviet_product_code VARCHAR(100) NOT NULL,
    kiotviet_product_name VARCHAR(500),
    barcode               VARCHAR(50),
    supplier_unit         VARCHAR(50),
    pos_unit              VARCHAR(50),
    conversion_rate       INT NOT NULL DEFAULT 1,
    source                VARCHAR(20) DEFAULT 'manual',
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),

    UNIQUE (supplier_code, supplier_item_code)
);

CREATE INDEX IF NOT EXISTS idx_mapping_supplier ON mapping_dictionary(supplier_code, supplier_item_code);
CREATE INDEX IF NOT EXISTS idx_mapping_barcode ON mapping_dictionary(barcode);
CREATE INDEX IF NOT EXISTS idx_mapping_kiotviet ON mapping_dictionary(kiotviet_product_code);

CREATE TABLE IF NOT EXISTS pricing_rules (
    id                SERIAL PRIMARY KEY,
    rule_type         VARCHAR(20) NOT NULL CHECK (rule_type IN ('category', 'supplier', 'product')),
    rule_key          VARCHAR(200) NOT NULL,
    margin_percent    DECIMAL(5,2) NOT NULL,
    rounding_rule     VARCHAR(20) DEFAULT 'none' CHECK (rounding_rule IN ('none', 'round_100', 'round_500', 'round_1000')),
    priority          INT DEFAULT 0,
    is_active         BOOLEAN DEFAULT TRUE,
    notes             TEXT,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW(),

    UNIQUE (rule_type, rule_key)
);

INSERT INTO pricing_rules (rule_type, rule_key, margin_percent, priority)
VALUES
('category', 'Nước ngọt', 15.00, 1),
('category', 'Bia', 12.00, 1),
('category', 'Mỹ phẩm', 20.00, 1),
('category', 'Sữa', 8.00, 1),
('category', 'Bánh kẹo', 18.00, 1),
('category', 'Gia vị', 15.00, 1),
('category', 'DEFAULT', 15.00, 0)
ON CONFLICT (rule_type, rule_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_sessions (
    id                SERIAL PRIMARY KEY,
    zalo_user_id      VARCHAR(100) NOT NULL,
    session_state     VARCHAR(50) NOT NULL DEFAULT 'idle',
    context_data      JSONB DEFAULT '{}'::jsonb,
    pending_invoice   JSONB DEFAULT NULL,
    expires_at        TIMESTAMP,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_user ON user_sessions(zalo_user_id);
CREATE INDEX IF NOT EXISTS idx_session_state ON user_sessions(session_state);

CREATE TABLE IF NOT EXISTS invoice_log (
    id                    SERIAL PRIMARY KEY,
    zalo_user_id          VARCHAR(100) NOT NULL,
    supplier_code         VARCHAR(100),
    source_type           VARCHAR(10) NOT NULL,
    source_url            TEXT,
    parsed_data           JSONB NOT NULL,
    kiotviet_po_id        BIGINT,
    kiotviet_po_code      VARCHAR(100),
    status                VARCHAR(30) DEFAULT 'processing',
    error_details         TEXT,
    llm_confidence        DECIMAL(5,2),
    processing_time_ms    INT,
    created_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kiotviet_product_cache (
    id                    SERIAL PRIMARY KEY,
    kiotviet_product_id   BIGINT NOT NULL UNIQUE,
    product_code          VARCHAR(100) NOT NULL,
    product_name          VARCHAR(500),
    barcode               VARCHAR(50),
    category_id           BIGINT,
    category_name         VARCHAR(200),
    base_price            DECIMAL(12,2),
    cost                  DECIMAL(12,2),
    inventory_quantity    INT,
    is_active             BOOLEAN DEFAULT TRUE,
    last_synced_at        TIMESTAMP DEFAULT NOW(),

    UNIQUE (product_code)
);

CREATE INDEX IF NOT EXISTS idx_cache_barcode ON kiotviet_product_cache(barcode);
CREATE INDEX IF NOT EXISTS idx_cache_name
    ON kiotviet_product_cache USING gin(to_tsvector('simple', product_name));

CREATE TABLE IF NOT EXISTS zalo_token_store (
    id                SERIAL PRIMARY KEY,
    token_type        VARCHAR(20) NOT NULL DEFAULT 'oa_access',
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    expires_at        TIMESTAMP NOT NULL,
    issued_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    refresh_count     INT DEFAULT 0,
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_active_token
    ON zalo_token_store(token_type)
    WHERE is_active = TRUE;

COMMIT;
