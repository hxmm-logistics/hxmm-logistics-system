ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS current_status VARCHAR(50);

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;

ALTER TABLE shipments
  ALTER COLUMN current_status TYPE VARCHAR(50),
  ALTER COLUMN status TYPE VARCHAR(50);

UPDATE shipments
SET current_status = CASE current_status
  WHEN 'PENDING' THEN 'CREATED'
  WHEN 'IN_CHINA_WAREHOUSE' THEN 'WAREHOUSE_RECEIVED'
  WHEN 'IN_CHINA_TRANSIT' THEN 'CHINA_TRANSIT'
  WHEN 'CUSTOMS' THEN 'CUSTOMS_CLEARANCE'
  WHEN 'IN_MYANMAR' THEN 'MYANMAR_TRANSIT'
  ELSE current_status
END,
status = CASE COALESCE(status, current_status)
  WHEN 'PENDING' THEN 'CREATED'
  WHEN 'INBOUND' THEN 'WAREHOUSE_RECEIVED'
  WHEN 'IN_CHINA_WAREHOUSE' THEN 'WAREHOUSE_RECEIVED'
  WHEN 'IN_CHINA_TRANSIT' THEN 'CHINA_TRANSIT'
  WHEN 'CUSTOMS' THEN 'CUSTOMS_CLEARANCE'
  WHEN 'IN_MYANMAR' THEN 'MYANMAR_TRANSIT'
  ELSE COALESCE(status, current_status)
END;

ALTER TABLE tracking_events
  ADD COLUMN IF NOT EXISTS event_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resulting_status VARCHAR(50);

ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_type_check;
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_source_check;
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_event_code_check;
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_resulting_status_check;
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_source_type_check;

UPDATE tracking_events
SET event_code = CASE
  WHEN event_code IN ('WAREHOUSE_RECEIVE','CHINA_DEPART','BORDER_ARRIVE','CUSTOMS_CLEAR','MYANMAR_ARRIVE','DISPATCH','DELIVER','EXCEPTION_REPORT') THEN event_code
  WHEN event_type IN ('PENDING','CREATED','INBOUND','WAREHOUSE_RECEIVED','IN_CHINA_WAREHOUSE','CHINA_WAREHOUSE','warehouse_in') THEN 'WAREHOUSE_RECEIVE'
  WHEN event_type IN ('CHINA_DEPART','CHINA_TRANSIT','IN_CHINA_TRANSIT') THEN 'CHINA_DEPART'
  WHEN event_type IN ('BORDER_ARRIVE','BORDER_ARRIVED','AT_BORDER') THEN 'BORDER_ARRIVE'
  WHEN event_type IN ('CUSTOMS_CLEAR','CUSTOMS_CLEARANCE','CUSTOMS') THEN 'CUSTOMS_CLEAR'
  WHEN event_type IN ('MYANMAR_ARRIVE','MYANMAR_TRANSIT','IN_MYANMAR') THEN 'MYANMAR_ARRIVE'
  WHEN event_type IN ('DISPATCH','OUT_FOR_DELIVERY') THEN 'DISPATCH'
  WHEN event_type IN ('DELIVER','DELIVERED') THEN 'DELIVER'
  WHEN event_type IN ('EXCEPTION_REPORT','EXCEPTION') THEN 'EXCEPTION_REPORT'
  ELSE event_code
END
WHERE event_code IS NULL;

UPDATE tracking_events
SET source_type = CASE
  WHEN source_type IN ('scan','system','admin') THEN source_type
  WHEN source_type IN ('MANUAL','manual','myanmar_scan') THEN 'scan'
  WHEN source_type IN ('SYSTEM','system','china_api','KUAIDI100','CAINIAO') THEN 'system'
  ELSE 'admin'
END;

UPDATE tracking_events
SET resulting_status = CASE event_code
  WHEN 'WAREHOUSE_RECEIVE' THEN 'WAREHOUSE_RECEIVED'
  WHEN 'CHINA_DEPART' THEN 'CHINA_TRANSIT'
  WHEN 'BORDER_ARRIVE' THEN 'AT_BORDER'
  WHEN 'CUSTOMS_CLEAR' THEN 'CUSTOMS_CLEARANCE'
  WHEN 'MYANMAR_ARRIVE' THEN 'MYANMAR_TRANSIT'
  WHEN 'DISPATCH' THEN 'OUT_FOR_DELIVERY'
  WHEN 'DELIVER' THEN 'DELIVERED'
  WHEN 'EXCEPTION_REPORT' THEN 'EXCEPTION'
END
WHERE resulting_status IS NULL;

UPDATE tracking_events
SET event_type = event_code
WHERE event_type IS DISTINCT FROM event_code;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tracking_events WHERE event_code IS NULL OR resulting_status IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce PHASE-1B tracking_events contract: unmapped rows exist';
  END IF;
END $$;

ALTER TABLE tracking_events
  ALTER COLUMN event_code SET NOT NULL,
  ALTER COLUMN resulting_status SET NOT NULL;

ALTER TABLE tracking_events
  ADD CONSTRAINT tracking_events_event_code_check
  CHECK (event_code IN ('WAREHOUSE_RECEIVE','CHINA_DEPART','BORDER_ARRIVE','CUSTOMS_CLEAR','MYANMAR_ARRIVE','DISPATCH','DELIVER','EXCEPTION_REPORT')),
  ADD CONSTRAINT tracking_events_resulting_status_check
  CHECK (resulting_status IN ('CREATED','WAREHOUSE_RECEIVED','CHINA_TRANSIT','AT_BORDER','CUSTOMS_CLEARANCE','MYANMAR_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURNED')),
  ADD CONSTRAINT tracking_events_source_type_check
  CHECK (source_type IN ('scan','system','admin'));

ALTER TABLE shipments
  ALTER COLUMN current_status SET DEFAULT 'CREATED';

ALTER TABLE shipments
  ADD CONSTRAINT shipments_status_check
  CHECK (current_status IN ('CREATED','WAREHOUSE_RECEIVED','CHINA_TRANSIT','AT_BORDER','CUSTOMS_CLEARANCE','MYANMAR_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURNED'));

CREATE INDEX IF NOT EXISTS idx_tracking_events_event_code ON tracking_events(event_code);
CREATE INDEX IF NOT EXISTS idx_tracking_events_resulting_status ON tracking_events(resulting_status);

CREATE OR REPLACE FUNCTION aggregate_shipment_status(p_shipment_id INTEGER)
RETURNS VOID AS $$
DECLARE
  latest_event RECORD;
  current_status_value VARCHAR(50);
  allowed_next VARCHAR(50)[];
BEGIN
  SELECT id, event_time, event_city, resulting_status
  INTO latest_event
  FROM tracking_events
  WHERE shipment_id = p_shipment_id
  ORDER BY event_time DESC, id DESC
  LIMIT 1;

  IF latest_event.id IS NULL THEN
    RETURN;
  END IF;

  SELECT current_status
  INTO current_status_value
  FROM shipments
  WHERE id = p_shipment_id;

  IF current_status_value IS NULL THEN
    RETURN;
  END IF;

  IF current_status_value IS DISTINCT FROM latest_event.resulting_status THEN
    allowed_next := CASE current_status_value
      WHEN 'CREATED' THEN ARRAY['WAREHOUSE_RECEIVED','EXCEPTION']
      WHEN 'WAREHOUSE_RECEIVED' THEN ARRAY['CHINA_TRANSIT','EXCEPTION']
      WHEN 'CHINA_TRANSIT' THEN ARRAY['AT_BORDER','EXCEPTION']
      WHEN 'AT_BORDER' THEN ARRAY['CUSTOMS_CLEARANCE','EXCEPTION']
      WHEN 'CUSTOMS_CLEARANCE' THEN ARRAY['MYANMAR_TRANSIT','EXCEPTION']
      WHEN 'MYANMAR_TRANSIT' THEN ARRAY['OUT_FOR_DELIVERY','EXCEPTION']
      WHEN 'OUT_FOR_DELIVERY' THEN ARRAY['DELIVERED','EXCEPTION']
      WHEN 'DELIVERED' THEN ARRAY[]::VARCHAR(50)[]
      WHEN 'EXCEPTION' THEN ARRAY['CREATED','WAREHOUSE_RECEIVED','CHINA_TRANSIT','AT_BORDER','CUSTOMS_CLEARANCE','MYANMAR_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','RETURNED']
      WHEN 'RETURNED' THEN ARRAY[]::VARCHAR(50)[]
      ELSE ARRAY[]::VARCHAR(50)[]
    END;

    IF NOT latest_event.resulting_status = ANY(allowed_next) THEN
      RAISE EXCEPTION 'Invalid status transition: % -> %', current_status_value, latest_event.resulting_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE shipments
  SET current_status = latest_event.resulting_status,
      status = latest_event.resulting_status,
      current_location = latest_event.event_city,
      current_node = latest_event.event_city,
      latest_event_id = latest_event.id,
      outbound_at = CASE
        WHEN latest_event.resulting_status IN ('CHINA_TRANSIT','AT_BORDER','CUSTOMS_CLEARANCE','MYANMAR_TRANSIT','OUT_FOR_DELIVERY') AND outbound_at IS NULL THEN latest_event.event_time
        ELSE outbound_at
      END,
      delivered_at = CASE WHEN latest_event.resulting_status = 'DELIVERED' THEN latest_event.event_time ELSE delivered_at END,
      updated_at = NOW()
  WHERE id = p_shipment_id
    AND (
      current_status IS DISTINCT FROM latest_event.resulting_status
      OR current_location IS DISTINCT FROM latest_event.event_city
      OR latest_event_id IS DISTINCT FROM latest_event.id
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tracking_events_after_insert_aggregate()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM aggregate_shipment_status(NEW.shipment_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tracking_events_after_insert_aggregate ON tracking_events;
CREATE TRIGGER trg_tracking_events_after_insert_aggregate
AFTER INSERT ON tracking_events
FOR EACH ROW
EXECUTE FUNCTION tracking_events_after_insert_aggregate();

