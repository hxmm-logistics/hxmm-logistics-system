CREATE TABLE IF NOT EXISTS tracking_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(40) NOT NULL,
  event_description TEXT NOT NULL,
  event_city VARCHAR(120) NOT NULL,
  operator_id INTEGER REFERENCES users(id),
  source_type VARCHAR(40) NOT NULL,
  external_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tracking_events_type_check CHECK (
    event_type IN (
      'PENDING',
      'IN_CHINA_WAREHOUSE',
      'IN_CHINA_TRANSIT',
      'AT_BORDER',
      'CUSTOMS',
      'CUSTOMS_CLEARANCE',
      'IN_MYANMAR',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'EXCEPTION'
    )
  ),
  CONSTRAINT tracking_events_source_check CHECK (
    source_type IN ('MANUAL', 'SYSTEM', 'KUAIDI100', 'CAINIAO')
  )
);

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS latest_event_id INTEGER REFERENCES tracking_events(id),
  ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_status_check CHECK (
  current_status IN (
    'PENDING',
    'IN_CHINA_WAREHOUSE',
    'IN_CHINA_TRANSIT',
    'AT_BORDER',
    'CUSTOMS',
    'CUSTOMS_CLEARANCE',
    'IN_MYANMAR',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION'
  )
);

INSERT INTO tracking_events (
  shipment_id,
  event_time,
  event_type,
  event_description,
  event_city,
  operator_id,
  source_type,
  external_payload,
  created_at
)
SELECT
  se.shipment_id,
  se.event_time,
  CASE
    WHEN se.event_type = 'CUSTOMS' THEN 'CUSTOMS_CLEARANCE'
    ELSE se.event_type
  END,
  COALESCE(NULLIF(se.remark, ''), se.event_type),
  se.location,
  NULL,
  CASE
    WHEN se.source = 'china_api' THEN 'KUAIDI100'
    WHEN se.source = 'system' THEN 'SYSTEM'
    ELSE 'MANUAL'
  END,
  jsonb_build_object('legacy_shipment_event_id', se.id, 'legacy_source', se.source),
  se.created_at
FROM shipment_events se
WHERE NOT EXISTS (
  SELECT 1
  FROM tracking_events te
  WHERE te.external_payload->>'legacy_shipment_event_id' = se.id::text
);

WITH latest AS (
  SELECT DISTINCT ON (shipment_id)
    id,
    shipment_id,
    event_type,
    event_city,
    event_time
  FROM tracking_events
  ORDER BY shipment_id, event_time DESC, id DESC
)
UPDATE shipments s
SET current_status = latest.event_type,
    status = latest.event_type,
    current_location = latest.event_city,
    current_node = latest.event_city,
    latest_event_id = latest.id,
    updated_at = GREATEST(s.updated_at, latest.event_time)
FROM latest
WHERE s.id = latest.shipment_id;

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_time ON tracking_events(shipment_id, event_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_event_type ON tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_events_source_type ON tracking_events(source_type);
