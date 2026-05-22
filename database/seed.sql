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
  china_carrier_code,
  china_carrier_name,
  china_tracking_no,
  customer_name,
  customer_phone,
  origin_country,
  destination_country,
  current_status,
  current_location
)
VALUES (
  'HX202605210001',
  'YTO',
  '圆通速递',
  'YT123456789CN',
  'Mg Aung',
  '+95 912345678',
  'China',
  'Myanmar',
  'IN_MYANMAR',
  '木姐'
)
ON CONFLICT (platform_tracking_no) DO NOTHING;

INSERT INTO shipment_events (shipment_id, event_type, event_time, location, remark, source, created_by)
SELECT id, 'PENDING', NOW() - INTERVAL '3 days', '中国卖家', '包裹已创建，等待中国快递揽收', 'system', 3
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM shipment_events
    WHERE shipment_id = shipments.id
      AND event_type = 'PENDING'
      AND location = '中国卖家'
      AND source = 'system'
  );

INSERT INTO shipment_events (shipment_id, event_type, event_time, location, remark, source, created_by)
SELECT id, 'IN_CHINA_TRANSIT', NOW() - INTERVAL '2 days', '云南昆明', '中国物流运输中', 'china_api', 1
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM shipment_events
    WHERE shipment_id = shipments.id
      AND event_type = 'IN_CHINA_TRANSIT'
      AND location = '云南昆明'
      AND source = 'china_api'
  );

INSERT INTO shipment_events (shipment_id, event_type, event_time, location, remark, source, created_by)
SELECT id, 'AT_BORDER', NOW() - INTERVAL '1 day', '瑞丽 / 木姐口岸', '包裹到达边境，等待交接', 'china_api', 1
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM shipment_events
    WHERE shipment_id = shipments.id
      AND event_type = 'AT_BORDER'
      AND location = '瑞丽 / 木姐口岸'
      AND source = 'china_api'
  );

INSERT INTO shipment_events (shipment_id, event_type, event_time, location, remark, source, created_by)
SELECT id, 'IN_MYANMAR', NOW() - INTERVAL '6 hours', '木姐', '缅甸物流扫码接货', 'myanmar_scan', 2
FROM shipments WHERE platform_tracking_no = 'HX202605210001'
  AND NOT EXISTS (
    SELECT 1 FROM shipment_events
    WHERE shipment_id = shipments.id
      AND event_type = 'IN_MYANMAR'
      AND location = '木姐'
      AND source = 'myanmar_scan'
  );

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
