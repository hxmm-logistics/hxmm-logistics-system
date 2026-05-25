BEGIN;

CREATE SEQUENCE IF NOT EXISTS batch_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_batch_number()
RETURNS VARCHAR(50) AS $$
DECLARE
  next_value BIGINT;
BEGIN
  next_value := nextval('batch_number_seq');
  RETURN 'BATCH-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(next_value::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS batches (
  id BIGSERIAL PRIMARY KEY,
  batch_number VARCHAR(50) NOT NULL UNIQUE,
  route_id BIGINT NULL,
  driver_name VARCHAR(100),
  driver_phone VARCHAR(20),
  vehicle_number VARCHAR(50),
  vehicle_type VARCHAR(50),
  departure_warehouse VARCHAR(100),
  arrival_warehouse VARCHAR(100),
  departure_time TIMESTAMPTZ,
  arrival_time TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  total_shipments INT NOT NULL DEFAULT 0,
  operator_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT batches_status_check CHECK (status IN ('PENDING', 'DEPARTED', 'ARRIVED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS batch_shipments (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by INTEGER,
  CONSTRAINT batch_shipments_unique_batch_shipment UNIQUE (batch_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_batches_batch_number ON batches(batch_number);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_departure_time ON batches(departure_time);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_shipments_batch_id ON batch_shipments(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_shipments_shipment_id ON batch_shipments(shipment_id);

DROP TRIGGER IF EXISTS trg_batches_updated_at ON batches;
CREATE TRIGGER trg_batches_updated_at
BEFORE UPDATE ON batches
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMIT;
