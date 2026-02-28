-- 002_invoice_log_msg_id.sql
-- Adds Zalo message id tracking for webhook deduplication (PRD E007 / Node 2 dedup guard).

BEGIN;

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS zalo_msg_id VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_invoice_log_zalo_msg_id
  ON invoice_log(zalo_msg_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_log_user_msg
  ON invoice_log(zalo_user_id, zalo_msg_id)
  WHERE zalo_msg_id IS NOT NULL;

COMMIT;

-- Down migration reference (manual):
-- DROP INDEX IF EXISTS uq_invoice_log_user_msg;
-- DROP INDEX IF EXISTS idx_invoice_log_zalo_msg_id;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS zalo_msg_id;
