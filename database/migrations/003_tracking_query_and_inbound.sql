ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS hx_no VARCHAR(40),
  ADD COLUMN IF NOT EXISTS tracking_no VARCHAR(80),
  ADD COLUMN IF NOT EXISTS carrier_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS carrier_name VARCHAR(80),
  ADD COLUMN IF NOT EXISTS status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS operator_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS warehouse_id INTEGER,
  ADD COLUMN IF NOT EXISTS current_node VARCHAR(120),
  ADD COLUMN IF NOT EXISTS inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

UPDATE shipments
SET hx_no = COALESCE(hx_no, platform_tracking_no),
    tracking_no = COALESCE(tracking_no, china_tracking_no, platform_tracking_no),
    carrier_code = COALESCE(carrier_code, china_carrier_code, 'UNKNOWN'),
    carrier_name = COALESCE(carrier_name, china_carrier_name, '未识别物流公司'),
    status = COALESCE(status, current_status),
    current_node = COALESCE(current_node, current_location),
    inbound_at = COALESCE(inbound_at, created_at)
WHERE hx_no IS NULL
   OR tracking_no IS NULL
   OR carrier_code IS NULL
   OR carrier_name IS NULL
   OR status IS NULL
   OR current_node IS NULL
   OR inbound_at IS NULL;

ALTER TABLE shipments
  ALTER COLUMN hx_no SET NOT NULL,
  ALTER COLUMN tracking_no SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipments_tracking_no_unique'
  ) THEN
    ALTER TABLE shipments ADD CONSTRAINT shipments_tracking_no_unique UNIQUE (tracking_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_hx_no ON shipments(hx_no);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_no ON shipments(tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_status_inbound ON shipments(status, inbound_at DESC);