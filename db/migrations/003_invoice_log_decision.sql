-- 003_invoice_log_decision.sql
-- Add decision tracking fields for Draft PO confirmation flow.

BEGIN;

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS decision_status VARCHAR(20)
  CHECK (decision_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS decision_payload JSONB;

ALTER TABLE invoice_log
ADD COLUMN IF NOT EXISTS decision_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_invoice_log_decision_status
  ON invoice_log(decision_status);

COMMIT;

-- Down migration reference (manual):
-- DROP INDEX IF EXISTS idx_invoice_log_decision_status;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS decision_at;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS decision_payload;
-- ALTER TABLE invoice_log DROP COLUMN IF EXISTS decision_status;
