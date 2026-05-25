BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment_time
  ON shipment_events(shipment_id, event_time DESC);

INSERT INTO shipment_events (shipment_id, event_type, event_time, location, remark, source, created_by, created_at)
SELECT
  te.shipment_id,
  CASE te.resulting_status
    WHEN 'CREATED' THEN 'PENDING'
    WHEN 'WAREHOUSE_RECEIVED' THEN 'PENDING'
    WHEN 'CHINA_TRANSIT' THEN 'IN_CHINA_TRANSIT'
    WHEN 'AT_BORDER' THEN 'AT_BORDER'
    WHEN 'CUSTOMS_CLEARANCE' THEN 'CUSTOMS'
    WHEN 'MYANMAR_TRANSIT' THEN 'IN_MYANMAR'
    WHEN 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
    WHEN 'DELIVERED' THEN 'DELIVERED'
    WHEN 'EXCEPTION' THEN 'EXCEPTION'
    ELSE 'PENDING'
  END AS event_type,
  te.event_time,
  te.event_city,
  te.event_description,
  CASE te.source_type
    WHEN 'scan' THEN 'myanmar_scan'
    WHEN 'admin' THEN 'manual'
    ELSE 'system'
  END AS source,
  NULL AS created_by,
  te.created_at
FROM tracking_events te
WHERE NOT EXISTS (
  SELECT 1
  FROM shipment_events se
  WHERE se.shipment_id = te.shipment_id
    AND se.event_time = te.event_time
    AND se.event_type = CASE te.resulting_status
      WHEN 'CREATED' THEN 'PENDING'
      WHEN 'WAREHOUSE_RECEIVED' THEN 'PENDING'
      WHEN 'CHINA_TRANSIT' THEN 'IN_CHINA_TRANSIT'
      WHEN 'AT_BORDER' THEN 'AT_BORDER'
      WHEN 'CUSTOMS_CLEARANCE' THEN 'CUSTOMS'
      WHEN 'MYANMAR_TRANSIT' THEN 'IN_MYANMAR'
      WHEN 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
      WHEN 'DELIVERED' THEN 'DELIVERED'
      WHEN 'EXCEPTION' THEN 'EXCEPTION'
      ELSE 'PENDING'
    END
);

COMMIT;
