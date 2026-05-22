import { query } from '../db.js';
import { assertTransition } from '../status.js';
import { fetchChinaTracking, normalizeChinaStatus } from './chinaLogistics.js';

const SYNCABLE_STATUSES = ['PENDING', 'IN_CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS'];

export async function syncOneChinaShipment(shipment) {
  if (!shipment.china_carrier_code || !shipment.china_tracking_no || !SYNCABLE_STATUSES.includes(shipment.current_status)) {
    return null;
  }

  const tracking = await fetchChinaTracking(shipment.china_carrier_code, shipment.china_tracking_no);
  if (!tracking) {
    return null;
  }

  const nextStatus = normalizeChinaStatus(tracking.rawStatus);
  assertTransition(shipment.current_status, nextStatus);
  if (nextStatus === shipment.current_status && tracking.location === shipment.current_location) {
    return null;
  }

  await query(
    `
      INSERT INTO shipment_events (shipment_id, event_type, location, remark, source, created_by)
      VALUES ($1, $2, $3, $4, 'china_api', 1)
    `,
    [shipment.id, nextStatus, tracking.location, tracking.remark || tracking.rawStatus]
  );

  await query(
    `
      UPDATE shipments
          SET current_status = $1,
          current_location = $2,
          updated_at = NOW()
      WHERE id = $3
    `,
    [nextStatus, tracking.location, shipment.id]
  );

  return nextStatus;
}

export function startChinaSyncJob() {
  const intervalMinutes = Number(process.env.CHINA_SYNC_INTERVAL_MINUTES || 15);
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  async function run() {
    try {
      const result = await query(
        `
          SELECT *
          FROM shipments
          WHERE china_tracking_no IS NOT NULL
            AND china_carrier_code IS NOT NULL
            AND current_status = ANY($1)
          ORDER BY updated_at ASC
          LIMIT 20
        `,
        [SYNCABLE_STATUSES]
      );

      for (const shipment of result.rows) {
        await syncOneChinaShipment(shipment);
      }
    } catch (error) {
      console.error('[HX MM china sync]', error.message);
    }
  }

  run();
  return setInterval(run, intervalMs);
}
