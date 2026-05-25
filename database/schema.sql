CREATE TABLE IF NOT EXISTS logistics_companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  country VARCHAR(40) NOT NULL,
  contact_phone VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operators (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(40),
  company_id INTEGER REFERENCES logistics_companies(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS platform_tracking_no_seq START 1;

CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  platform_tracking_no VARCHAR(40) NOT NULL UNIQUE,
  china_carrier_code VARCHAR(20),
  china_carrier_name VARCHAR(80),
  china_tracking_no VARCHAR(80),
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  origin_country VARCHAR(40) NOT NULL DEFAULT 'China',
  destination_country VARCHAR(40) NOT NULL DEFAULT 'Myanmar',
  current_status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
  current_location VARCHAR(120) NOT NULL DEFAULT '中国卖家已创建',
  hx_no VARCHAR(40),
  tracking_no VARCHAR(80),
  carrier_code VARCHAR(20),
  carrier_name VARCHAR(80),
  status VARCHAR(50),
  operator_id INTEGER,
  warehouse_id INTEGER,
  current_node VARCHAR(120),
  inbound_at TIMESTAMPTZ,
  outbound_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  latest_event_id INTEGER,
  estimated_delivery TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipments_status_check CHECK (
    current_status IN (
      'CREATED',
      'WAREHOUSE_RECEIVED',
      'CHINA_TRANSIT',
      'AT_BORDER',
      'CUSTOMS_CLEARANCE',
      'MYANMAR_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'EXCEPTION',
      'RETURNED'
    )
  )
);


CREATE INDEX IF NOT EXISTS idx_shipments_platform_tracking_no ON shipments(platform_tracking_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_tracking_no_unique ON shipments(tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_hx_no ON shipments(hx_no);
CREATE INDEX IF NOT EXISTS idx_shipments_status_inbound ON shipments(status, inbound_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_china_carrier_tracking ON shipments(china_carrier_code, china_tracking_no);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  operator_id INTEGER REFERENCES operators(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator'))
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_code VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  resulting_status VARCHAR(50) NOT NULL,
  event_description TEXT NOT NULL,
  event_city VARCHAR(120) NOT NULL,
  operator_id INTEGER REFERENCES users(id),
  source_type VARCHAR(40) NOT NULL,
  external_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tracking_events_event_code_check CHECK (
    event_code IN (
      'WAREHOUSE_RECEIVE',
      'CHINA_DEPART',
      'BORDER_ARRIVE',
      'CUSTOMS_CLEAR',
      'MYANMAR_ARRIVE',
      'DISPATCH',
      'DELIVER',
      'EXCEPTION_REPORT'
    )
  ),
  CONSTRAINT tracking_events_resulting_status_check CHECK (
    resulting_status IN (
      'CREATED',
      'WAREHOUSE_RECEIVED',
      'CHINA_TRANSIT',
      'AT_BORDER',
      'CUSTOMS_CLEARANCE',
      'MYANMAR_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'EXCEPTION',
      'RETURNED'
    )
  ),
  CONSTRAINT tracking_events_source_type_check CHECK (
    source_type IN ('scan', 'system', 'admin')
  )
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_time ON tracking_events(shipment_id, event_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_event_type ON tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_events_event_code ON tracking_events(event_code);
CREATE INDEX IF NOT EXISTS idx_tracking_events_resulting_status ON tracking_events(resulting_status);
CREATE INDEX IF NOT EXISTS idx_tracking_events_source_type ON tracking_events(source_type);

CREATE TABLE IF NOT EXISTS shipment_status_logs (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status VARCHAR(40) NOT NULL,
  location VARCHAR(120) NOT NULL,
  source VARCHAR(40) NOT NULL,
  remark TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id INTEGER,
  platform_tracking_no VARCHAR(40),
  detail JSONB,
  ip_address VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_shipment_status_logs_shipment ON shipment_status_logs(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_entity ON operation_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id, created_at DESC);




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
