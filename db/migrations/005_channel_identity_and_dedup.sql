-- 005_channel_identity_and_dedup.sql
-- Add channel-aware sender/message identity and tenant links for multi-channel ingress.

BEGIN;

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'zalo';

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS sender_id VARCHAR(120);

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS msg_id VARCHAR(120);

UPDATE invoice_log
SET channel = COALESCE(channel, 'zalo'),
    sender_id = COALESCE(sender_id, zalo_user_id),
    msg_id = COALESCE(msg_id, zalo_msg_id)
WHERE sender_id IS NULL OR msg_id IS NULL OR channel IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_log_channel_sender
  ON invoice_log(channel, sender_id);

CREATE INDEX IF NOT EXISTS idx_invoice_log_msg_id
  ON invoice_log(msg_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_log_channel_sender_msg
  ON invoice_log(channel, sender_id, msg_id)
  WHERE msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_links (
  id SERIAL PRIMARY KEY,
  channel VARCHAR(20) NOT NULL,
  sender_id VARCHAR(120) NOT NULL,
  tenant_id VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(channel, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_links_tenant
  ON tenant_links(tenant_id);

COMMIT;

-- Down migration reference (manual):
-- DROP INDEX IF EXISTS idx_tenant_links_tenant;
-- DROP TABLE IF EXISTS tenant_links;
-- DROP INDEX IF EXISTS uq_invoice_log_channel_sender_msg;
-- DROP INDEX IF EXISTS idx_invoice_log_msg_id;
-- DROP INDEX IF EXISTS idx_invoice_log_channel_sender;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS msg_id;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS sender_id;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS channel;
