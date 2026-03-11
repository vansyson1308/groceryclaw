-- 004_ops_metrics.sql
-- Operational visibility tables for events + daily metrics rollups.

BEGIN;

CREATE TABLE IF NOT EXISTS ops_metrics_daily (
    metric_date         DATE NOT NULL,
    tenant_id           VARCHAR(100),
    invoices_total      INT NOT NULL DEFAULT 0,
    completed           INT NOT NULL DEFAULT 0,
    failed              INT NOT NULL DEFAULT 0,
    needs_mapping       INT NOT NULL DEFAULT 0,
    needs_review        INT NOT NULL DEFAULT 0,
    avg_processing_ms   INT,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (metric_date, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_metrics_daily_date
    ON ops_metrics_daily(metric_date DESC);

CREATE TABLE IF NOT EXISTS ops_events (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMP NOT NULL DEFAULT NOW(),
    level           VARCHAR(10) NOT NULL CHECK (level IN ('debug','info','warn','error')),
    workflow        VARCHAR(120) NOT NULL,
    event_type      VARCHAR(120) NOT NULL,
    message         TEXT NOT NULL,
    context         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_events_ts ON ops_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_level ON ops_events(level);
CREATE INDEX IF NOT EXISTS idx_ops_events_workflow ON ops_events(workflow);
CREATE INDEX IF NOT EXISTS idx_ops_events_event_type ON ops_events(event_type);

COMMIT;

-- Down migration reference (manual):
-- DROP TABLE IF EXISTS ops_events;
-- DROP TABLE IF EXISTS ops_metrics_daily;
