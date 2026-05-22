CREATE SEQUENCE IF NOT EXISTS platform_tracking_no_seq START 1;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS platform_tracking_no VARCHAR(40),
  ADD COLUMN IF NOT EXISTS china_carrier_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS china_carrier_name VARCHAR(80);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'shipments'
      AND column_name = 'tracking_no'
  ) THEN
    EXECUTE 'UPDATE shipments SET platform_tracking_no = tracking_no WHERE platform_tracking_no IS NULL';
  END IF;
END $$;

ALTER TABLE shipments
  ALTER COLUMN platform_tracking_no SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'shipments'
      AND constraint_name = 'shipments_tracking_no_key'
  ) THEN
    ALTER TABLE shipments DROP CONSTRAINT shipments_tracking_no_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'shipments'
      AND constraint_name = 'shipments_platform_tracking_no_key'
  ) THEN
    ALTER TABLE shipments ADD CONSTRAINT shipments_platform_tracking_no_key UNIQUE (platform_tracking_no);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_shipments_tracking_no;
DROP INDEX IF EXISTS idx_shipments_china_tracking_no;
CREATE INDEX IF NOT EXISTS idx_shipments_platform_tracking_no ON shipments(platform_tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_china_carrier_tracking ON shipments(china_carrier_code, china_tracking_no);

ALTER TABLE shipments DROP COLUMN IF EXISTS tracking_no;

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
