-- migrate:up
-- Migration 020: ShopVoice shop memory. Rules the owner stated explicitly
-- ("Always order milk from Green Valley", "Never order more than 60 eggs",
-- "Skip cola", "I usually order on Mondays"), kept across sessions and applied
-- by suggest_reorder / create_reorder_draft. One row per (tenant, voice
-- profile, kind, subject); re-stating a rule replaces it. Tenant-scoped with
-- FORCEd RLS like every ShopVoice table (017).
BEGIN;

CREATE TABLE IF NOT EXISTS shop_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Who stated it: Alexa+ voice profile, or one browser in the simulator. 'owner' by default.
  voice_profile TEXT NOT NULL DEFAULT 'owner' CHECK (voice_profile ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind TEXT NOT NULL CHECK (kind IN ('preferred_supplier', 'max_order_qty', 'skip_item', 'order_day')),
  -- Product words the rule applies to ("milk"); '' for order_day.
  subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 80),
  supplier_code TEXT,
  max_qty NUMERIC(12,2) CHECK (max_qty IS NULL OR max_qty > 0),
  weekday TEXT CHECK (weekday IS NULL OR weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  -- The owner's own words, shown back by "what do you remember?".
  statement TEXT NOT NULL DEFAULT '' CHECK (length(statement) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, voice_profile, kind, subject)
);

CREATE INDEX IF NOT EXISTS idx_shop_preferences_tenant_profile ON shop_preferences (tenant_id, voice_profile);

ALTER TABLE shop_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_shop_preferences_app_user ON shop_preferences;
CREATE POLICY rls_shop_preferences_app_user ON shop_preferences
  USING (tenant_id = _rls_tenant_id())
  WITH CHECK (tenant_id = _rls_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON shop_preferences TO groceryclaw_app_user;

COMMIT;

-- migrate:down
BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE ON shop_preferences FROM groceryclaw_app_user;
DROP POLICY IF EXISTS rls_shop_preferences_app_user ON shop_preferences;
DROP TABLE IF EXISTS shop_preferences;

COMMIT;
