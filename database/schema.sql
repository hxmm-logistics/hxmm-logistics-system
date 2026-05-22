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
  current_status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  current_location VARCHAR(120) NOT NULL DEFAULT '中国卖家已创建',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipments_status_check CHECK (
    current_status IN (
      'PENDING',
      'IN_CHINA_TRANSIT',
      'AT_BORDER',
      'CUSTOMS',
      'IN_MYANMAR',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'EXCEPTION'
    )
  )
);

CREATE TABLE IF NOT EXISTS shipment_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location VARCHAR(120) NOT NULL,
  remark TEXT,
  source VARCHAR(40) NOT NULL,
  created_by INTEGER REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipment_events_status_check CHECK (
    event_type IN (
      'PENDING',
      'IN_CHINA_TRANSIT',
      'AT_BORDER',
      'CUSTOMS',
      'IN_MYANMAR',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'EXCEPTION'
    )
  ),
  CONSTRAINT shipment_events_source_check CHECK (
    source IN ('china_api', 'myanmar_scan', 'manual', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_shipments_platform_tracking_no ON shipments(platform_tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_china_carrier_tracking ON shipments(china_carrier_code, china_tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment_time ON shipment_events(shipment_id, event_time DESC);

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

CREATE TABLE IF NOT EXISTS shipment_status_logs (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  from_status VARCHAR(40),
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
