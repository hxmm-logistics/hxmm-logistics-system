BEGIN;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS exceptions (
  id BIGSERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  batch_id BIGINT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  exception_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  description TEXT NOT NULL,
  reporter_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  reporter_name VARCHAR(100),
  handler_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  handler_name VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exceptions_exception_type_check CHECK (
    exception_type IN ('LOST', 'DAMAGED', 'CUSTOMS_HOLD', 'ADDRESS_ISSUE', 'CONTACT_ISSUE', 'REJECTED', 'DELAY', 'OTHER')
  ),
  CONSTRAINT exceptions_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED')),
  CONSTRAINT exceptions_severity_check CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

CREATE INDEX IF NOT EXISTS idx_exceptions_shipment_id ON exceptions(shipment_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_batch_id ON exceptions(batch_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions(status);
CREATE INDEX IF NOT EXISTS idx_exceptions_exception_type ON exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_exceptions_severity ON exceptions(severity);
CREATE INDEX IF NOT EXISTS idx_exceptions_created_at ON exceptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_open ON exceptions(status, severity, created_at DESC)
  WHERE status IN ('PENDING', 'PROCESSING');

DROP TRIGGER IF EXISTS trg_exceptions_updated_at ON exceptions;
CREATE TRIGGER trg_exceptions_updated_at
BEFORE UPDATE ON exceptions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMIT;
