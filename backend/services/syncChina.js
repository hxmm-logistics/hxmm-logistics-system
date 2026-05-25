import { pool, query } from '../db.js';
import { createEvent, statusFromEventCode } from './trackingEvents.js';
import { fetchChinaTracking, normalizeChinaEventCode } from './chinaLogistics.js';

const SYNCABLE_STATUSES = ['WAREHOUSE_RECEIVED', 'CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE'];

export async function syncOneChinaShipment(shipment) {
  if (!shipment.china_carrier_code || !shipment.china_tracking_no || !SYNCABLE_STATUSES.includes(shipment.current_status)) {
    return null;
  }

  const tracking = await fetchChinaTracking(shipment.china_carrier_code, shipment.china_tracking_no);
  if (!tracking) {
    return null;
  }

  const eventCode = normalizeChinaEventCode(tracking.rawStatus);
  const nextStatus = statusFromEventCode(eventCode);
  if (nextStatus === shipment.current_status && tracking.location === shipment.current_location) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createEvent(
      {
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no || shipment.china_tracking_no,
        event_code: eventCode,
        event_description: tracking.remark || tracking.rawStatus,
        event_city: tracking.location,
        source_type: 'system',
        external_ref: `${shipment.china_carrier_code}:${shipment.china_tracking_no}:${tracking.rawStatus}`,
        external_payload: {
          carrier_code: shipment.china_carrier_code,
          tracking_no: shipment.china_tracking_no,
          raw_status: tracking.rawStatus,
        },
      },
      client
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

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

