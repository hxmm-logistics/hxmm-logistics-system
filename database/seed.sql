INSERT INTO logistics_companies (id, name, country, contact_phone)
VALUES
  (1, 'HX MM China Logistics', 'China', '+86 13800000000'),
  (2, 'HX MM Myanmar Logistics', 'Myanmar', '+95 900000000')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country,
    contact_phone = EXCLUDED.contact_phone;

INSERT INTO operators (id, name, phone, company_id)
VALUES
  (1, '中国同步系统', NULL, 1),
  (2, '木姐扫码员', '+95 912345678', 2),
  (3, '后台管理员', '+95 987654321', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shipments (
  platform_tracking_no,
  hx_no,
  tracking_no,
  carrier_code,
  carrier_name,
  china_carrier_code,
  china_carrier_name,
  china_tracking_no,
  customer_name,
  customer_phone,
  origin_country,
  destination_country,
  current_location,
  current_node
)
VALUES (
  'HX202605210001',
  'HX202605210001',
  'YT123456789CN',
  'YTO',
  '圆通速递',
  'YTO',
  '圆通速递',
  'YT123456789CN',
  'Mg Aung',
  '+95 912345678',
  'China',
  'Myanmar',
  '中国卖家',
  '中国卖家'
)
ON CONFLICT (platform_tracking_no) DO NOTHING;

INSERT INTO tracking_events (shipment_id, event_time, event_code, event_type, resulting_status, event_description, event_city, operator_id, source_type, external_payload)
SELECT id, NOW() - INTERVAL '3 days', 'WAREHOUSE_RECEIVE', 'WAREHOUSE_RECEIVE', 'WAREHOUSE_RECEIVED', '包裹已创建，等待中国快递揽收', '中国卖家', NULL, 'system', '{"seed":true}'::jsonb
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM tracking_events
    WHERE shipment_id = shipments.id
      AND event_code = 'WAREHOUSE_RECEIVE'
      AND event_city = '中国卖家'
      AND source_type = 'system'
  );

INSERT INTO tracking_events (shipment_id, event_time, event_code, event_type, resulting_status, event_description, event_city, operator_id, source_type, external_payload)
SELECT id, NOW() - INTERVAL '2 days', 'CHINA_DEPART', 'CHINA_DEPART', 'CHINA_TRANSIT', '中国物流运输中', '云南昆明', NULL, 'system', '{"seed":true,"legacy_source":"china_api"}'::jsonb
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM tracking_events
    WHERE shipment_id = shipments.id
      AND event_code = 'CHINA_DEPART'
      AND event_city = '云南昆明'
      AND source_type = 'system'
  );

INSERT INTO tracking_events (shipment_id, event_time, event_code, event_type, resulting_status, event_description, event_city, operator_id, source_type, external_payload)
SELECT id, NOW() - INTERVAL '1 day', 'BORDER_ARRIVE', 'BORDER_ARRIVE', 'AT_BORDER', '包裹到达边境，等待交接', '瑞丽 / 木姐口岸', NULL, 'system', '{"seed":true,"legacy_source":"china_api"}'::jsonb
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM tracking_events
    WHERE shipment_id = shipments.id
      AND event_code = 'BORDER_ARRIVE'
      AND event_city = '瑞丽 / 木姐口岸'
      AND source_type = 'system'
  );

INSERT INTO tracking_events (shipment_id, event_time, event_code, event_type, resulting_status, event_description, event_city, operator_id, source_type, external_payload)
SELECT id, NOW() - INTERVAL '6 hours', 'MYANMAR_ARRIVE', 'MYANMAR_ARRIVE', 'MYANMAR_TRANSIT', '缅甸物流扫码接货', '木姐', NULL, 'scan', '{"seed":true,"legacy_source":"myanmar_scan"}'::jsonb
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM tracking_events
    WHERE shipment_id = shipments.id
      AND event_code = 'MYANMAR_ARRIVE'
      AND event_city = '木姐'
      AND source_type = 'scan'
  );

DO $$
DECLARE
  seed_shipment_id integer;
BEGIN
  SELECT id INTO seed_shipment_id
  FROM shipments
  WHERE platform_tracking_no = 'HX202605210001';

  IF seed_shipment_id IS NOT NULL AND to_regprocedure('aggregate_shipment_status(integer)') IS NOT NULL THEN
    PERFORM aggregate_shipment_status(seed_shipment_id);
  END IF;
END $$;

SELECT setval(
  'platform_tracking_no_seq',
  GREATEST(
    COALESCE((
      SELECT MAX((substring(platform_tracking_no from 11))::bigint)
      FROM shipments
      WHERE platform_tracking_no ~ '^HX[0-9]{8}[0-9]+$'
    ), 0),
    1
  ),
  true
);


