import { query } from '../db.js';
import { assertTransition, canTransition, normalizeStatus } from '../status.js';
import { normalizeTrackingNo } from './carrier.js';

export const TRACKING_EVENT_CODES = [
  'WAREHOUSE_RECEIVE',
  'CHINA_DEPART',
  'BORDER_ARRIVE',
  'CUSTOMS_CLEAR',
  'MYANMAR_ARRIVE',
  'DISPATCH',
  'DELIVER',
  'EXCEPTION_REPORT',
];

export const TRACKING_SOURCE_TYPES = ['scan', 'system', 'admin'];

export const EVENT_CODE_TO_STATUS = {
  WAREHOUSE_RECEIVE: 'WAREHOUSE_RECEIVED',
  CHINA_DEPART: 'CHINA_TRANSIT',
  BORDER_ARRIVE: 'AT_BORDER',
  CUSTOMS_CLEAR: 'CUSTOMS_CLEARANCE',
  MYANMAR_ARRIVE: 'MYANMAR_TRANSIT',
  DISPATCH: 'OUT_FOR_DELIVERY',
  DELIVER: 'DELIVERED',
  EXCEPTION_REPORT: 'EXCEPTION',
};

const LEGACY_EVENT_CODE_MAP = {
  PENDING: 'WAREHOUSE_RECEIVE',
  CREATED: 'WAREHOUSE_RECEIVE',
  INBOUND: 'WAREHOUSE_RECEIVE',
  WAREHOUSE_RECEIVED: 'WAREHOUSE_RECEIVE',
  IN_CHINA_WAREHOUSE: 'WAREHOUSE_RECEIVE',
  CHINA_WAREHOUSE: 'WAREHOUSE_RECEIVE',
  WAREHOUSE_IN: 'WAREHOUSE_RECEIVE',
  CHINA_TRANSIT: 'CHINA_DEPART',
  IN_CHINA_TRANSIT: 'CHINA_DEPART',
  CHINA_DEPART: 'CHINA_DEPART',
  AT_BORDER: 'BORDER_ARRIVE',
  BORDER_ARRIVED: 'BORDER_ARRIVE',
  BORDER_ARRIVE: 'BORDER_ARRIVE',
  CUSTOMS: 'CUSTOMS_CLEAR',
  CUSTOMS_CLEARANCE: 'CUSTOMS_CLEAR',
  CUSTOMS_CLEAR: 'CUSTOMS_CLEAR',
  IN_MYANMAR: 'MYANMAR_ARRIVE',
  MYANMAR_TRANSIT: 'MYANMAR_ARRIVE',
  MYANMAR_ARRIVE: 'MYANMAR_ARRIVE',
  OUT_FOR_DELIVERY: 'DISPATCH',
  DISPATCH: 'DISPATCH',
  DELIVERED: 'DELIVER',
  DELIVER: 'DELIVER',
  EXCEPTION: 'EXCEPTION_REPORT',
  EXCEPTION_REPORT: 'EXCEPTION_REPORT',
};

const LEGACY_SOURCE_MAP = {
  china_api: 'system',
  kuaidi100: 'system',
  KUAIDI100: 'system',
  cainiao: 'system',
  CAINIAO: 'system',
  api: 'system',
  API: 'system',
  myanmar_scan: 'scan',
  manual: 'admin',
  MANUAL: 'admin',
  SYSTEM: 'system',
  system: 'system',
  scan: 'scan',
  admin: 'admin',
};

export function isValidTrackingFormat(trackingNo) {
  const normalized = normalizeTrackingNo(trackingNo);
  if (!normalized) return false;
  if (/^HX\d{8,}$/i.test(normalized)) return false;
  if (!/^[A-Z0-9]{8,32}$/.test(normalized)) return false;

  const carrierRules = [
    { prefix: /^YT[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^YTO[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^JT[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^JNT[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^SF[A-Z0-9]+$/, min: 10, max: 20 },
    { prefix: /^ZTO[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^STO[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^YD[A-Z0-9]+$/, min: 10, max: 24 },
    { prefix: /^YUNDA[A-Z0-9]+$/, min: 10, max: 24 },
  ];

  const matchedRule = carrierRules.find((rule) => rule.prefix.test(normalized));
  if (matchedRule) {
    return normalized.length >= matchedRule.min && normalized.length <= matchedRule.max;
  }

  return /^\d{8,32}$/.test(normalized);
}
export function normalizeTrackingEventCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return LEGACY_EVENT_CODE_MAP[normalized] || normalized;
}

export const normalizeTrackingEventType = normalizeTrackingEventCode;

export function normalizeSourceType(sourceType) {
  const raw = String(sourceType || '').trim();
  return LEGACY_SOURCE_MAP[raw] || raw.toLowerCase();
}

export function assertTrackingEventCode(eventCode) {
  if (!TRACKING_EVENT_CODES.includes(eventCode)) {
    const error = new Error(`Invalid tracking event code: ${eventCode}`);
    error.status = 400;
    throw error;
  }
}

export const assertTrackingEventType = assertTrackingEventCode;

export function assertTrackingSourceType(sourceType) {
  if (!TRACKING_SOURCE_TYPES.includes(sourceType)) {
    const error = new Error(`Invalid tracking source type: ${sourceType}`);
    error.status = 400;
    throw error;
  }
}

export function statusFromEventCode(eventCode) {
  return EVENT_CODE_TO_STATUS[eventCode] || null;
}

export async function listTrackingEvents(shipmentId, db = { query }) {
  const result = await db.query(
    `
      SELECT te.*,
             COALESCE(te.event_code, te.event_type) AS event_code,
             COALESCE(te.resulting_status, te.event_type) AS resulting_status,
             u.username,
             u.display_name AS operator_name
      FROM tracking_events te
      LEFT JOIN users u ON u.id = te.operator_id
      WHERE te.shipment_id = $1
      ORDER BY te.event_time DESC, te.id DESC
    `,
    [shipmentId]
  );
  return result.rows;
}

function resolveDb(options, db) {
  if (options?.query && !db) {
    return { options: {}, db: options };
  }
  return { options: options || {}, db: db || { query } };
}

function assertReplayTransition(fromStatus, toStatus, event) {
  if (fromStatus === toStatus) return;
  if (canTransition(fromStatus, toStatus)) return;
  const error = new Error(`Invalid status transition: ${fromStatus} -> ${toStatus}`);
  error.status = 409;
  error.details = {
    shipment_id: event.shipment_id,
    event_id: event.id,
    event_code: event.event_code || event.event_type,
  };
  throw error;
}

/**
 * Pure aggregation: computes shipment state from tracking_events only.
 * @param {number|string} shipmentId
 * @param {Object} options
 * @param {Date|string} [options.until_time]
 * @returns {Promise<Object>} { current_status, current_city, latest_event_id, updated_at }
 */
export async function aggregateShipmentStatus(shipmentId, options = {}, dbArg = null) {
  const resolved = resolveDb(options, dbArg);
  const db = resolved.db;
  const untilTime = resolved.options.until_time || null;
  const params = [shipmentId];
  let timeFilter = '';
  if (untilTime) {
    params.push(untilTime);
    timeFilter = `AND event_time <= $${params.length}::timestamptz`;
  }

  const result = await db.query(
    `
      SELECT id, shipment_id, event_time, event_code, event_type, event_city, resulting_status
      FROM tracking_events
      WHERE shipment_id = $1
        ${timeFilter}
      ORDER BY event_time ASC, id ASC
    `,
    params
  );

  let currentStatus = 'CREATED';
  let latest = null;
  for (const event of result.rows) {
    const eventCode = normalizeTrackingEventCode(event.event_code || event.event_type);
    assertTrackingEventCode(eventCode);
    const nextStatus = event.resulting_status ? normalizeStatus(event.resulting_status) : statusFromEventCode(eventCode);
    if (!nextStatus) continue;
    assertReplayTransition(currentStatus, nextStatus, event);
    currentStatus = nextStatus;
    latest = {
      ...event,
      event_code: eventCode,
      resulting_status: nextStatus,
    };
  }

  if (!latest) {
    return {
      current_status: null,
      current_city: null,
      latest_event_id: null,
      updated_at: null,
    };
  }

  return {
    current_status: currentStatus,
    current_city: latest.event_city,
    latest_event_id: latest.id,
    updated_at: latest.event_time,
  };
}

export async function applyShipmentAggregation(shipmentId, options = {}, dbArg = null) {
  const resolved = resolveDb(options, dbArg);
  const db = resolved.db;
  const aggregation = await aggregateShipmentStatus(shipmentId, resolved.options, db);
  if (!aggregation.current_status) return aggregation;

  const update = await db.query(
    `
      UPDATE shipments
      SET current_status = $1,
          status = $1,
          current_location = $2,
          current_node = $2,
          latest_event_id = $3,
          outbound_at = CASE
            WHEN $1 IN ('CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE', 'MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY') AND outbound_at IS NULL THEN $4
            ELSE outbound_at
          END,
          delivered_at = CASE WHEN $1 = 'DELIVERED' THEN $4 ELSE delivered_at END,
          updated_at = NOW()
      WHERE id = $5
        AND (
          current_status IS DISTINCT FROM $1
          OR current_location IS DISTINCT FROM $2
          OR latest_event_id IS DISTINCT FROM $3
        )
      RETURNING *
    `,
    [aggregation.current_status, aggregation.current_city, aggregation.latest_event_id, aggregation.updated_at, shipmentId]
  );

  return {
    ...aggregation,
    shipment: update.rows[0] || null,
  };
}

export async function rebuildShipmentStatus(shipmentId, options = {}, db = { query }) {
  return applyShipmentAggregation(shipmentId, options, db);
}

export async function rebuildShipmentStatuses({ limit = 500, offset = 0 } = {}, db = { query }) {
  const result = await db.query(
    `
      SELECT id
      FROM shipments
      ORDER BY id ASC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  const rebuilt = [];
  for (const row of result.rows) {
    rebuilt.push(await rebuildShipmentStatus(row.id, {}, db));
  }
  return rebuilt;
}

async function findShipmentForEvent({ tracking_no, shipment_id }, db) {
  if (shipment_id) {
    const byId = await db.query(
      'SELECT * FROM shipments WHERE id = $1 FOR UPDATE',
      [shipment_id]
    );
    return byId.rows[0] || null;
  }

  const normalizedTrackingNo = normalizeTrackingNo(tracking_no);
  if (!normalizedTrackingNo) return null;
  const byTrackingNo = await db.query(
    `
      SELECT *
      FROM shipments
      WHERE tracking_no = $1
         OR china_tracking_no = $1
         OR platform_tracking_no = $1
         OR hx_no = $1
      LIMIT 1
      FOR UPDATE
    `,
    [normalizedTrackingNo]
  );
  return byTrackingNo.rows[0] || null;
}

function buildExternalPayload(externalPayload, externalRef) {
  return {
    ...(externalPayload || {}),
    ...(externalRef ? { external_ref: String(externalRef) } : {}),
  };
}

async function findIdempotentEvent({ shipmentId, eventCode, sourceType, externalRef }, db) {
  if (!externalRef) return null;
  const result = await db.query(
    `
      SELECT *
      FROM tracking_events
      WHERE shipment_id = $1
        AND event_code = $2
        AND source_type = $3
        AND external_payload ->> 'external_ref' = $4
      ORDER BY id DESC
      LIMIT 1
    `,
    [shipmentId, eventCode, sourceType, String(externalRef)]
  );
  return result.rows[0] || null;
}

export async function createEvent(
  {
    tracking_no,
    shipment_id,
    event_code,
    event_type,
    event_city = null,
    event_description = null,
    source_type = 'system',
    event_time = null,
    external_ref = null,
    external_payload = {},
    operator_id = null,
    user_id = null,
    ip_address = null,
  },
  db = { query }
) {
  const eventCode = normalizeTrackingEventCode(event_code || event_type);
  const sourceType = normalizeSourceType(source_type);
  assertTrackingEventCode(eventCode);
  assertTrackingSourceType(sourceType);

  const resultingStatus = statusFromEventCode(eventCode);
  const shipment = await findShipmentForEvent({ tracking_no, shipment_id }, db);
  if (!shipment) {
    const error = new Error('Shipment not found');
    error.status = 404;
    throw error;
  }

  const currentStatus = normalizeStatus(shipment.current_status || shipment.status || 'CREATED');
  if (currentStatus === 'DELIVERED' && eventCode === 'DELIVER') {
    const existingDelivered = await db.query(
      `
        SELECT *
        FROM tracking_events
        WHERE shipment_id = $1
          AND event_code = 'DELIVER'
        ORDER BY event_time DESC, id DESC
        LIMIT 1
      `,
      [shipment.id]
    );
    return { event: existingDelivered.rows[0] || null, shipment, ignored: true, duplicate: true };
  }
  assertTransition(currentStatus, resultingStatus);

  const duplicate = await findIdempotentEvent({ shipmentId: shipment.id, eventCode, sourceType, externalRef: external_ref }, db);
  if (duplicate) {
    return { event: duplicate, shipment, ignored: true, duplicate: true };
  }

  const payload = buildExternalPayload(external_payload, external_ref);
  const result = await db.query(
    `
      INSERT INTO tracking_events (
        shipment_id,
        event_time,
        event_code,
        event_type,
        resulting_status,
        event_description,
        event_city,
        operator_id,
        source_type,
        external_payload
      )
      VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING *
    `,
    [
      shipment.id,
      event_time,
      eventCode,
      resultingStatus,
      event_description || eventCode,
      event_city || shipment.current_node || shipment.current_location || '',
      operator_id || user_id || null,
      sourceType,
      JSON.stringify(payload),
    ]
  );

  const event = result.rows[0];
  await db.query(
    `
      INSERT INTO shipment_status_logs (shipment_id, from_status, to_status, location, source, remark, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      shipment.id,
      currentStatus,
      resultingStatus,
      event.event_city,
      sourceType,
      event.event_description,
      user_id || operator_id || null,
    ]
  );
  await applyShipmentAggregation(shipment.id, {}, db);

  if (user_id || ip_address) {
    await db.query(
      `
        INSERT INTO operation_logs (user_id, action, entity_type, entity_id, platform_tracking_no, detail, ip_address)
        VALUES ($1, 'TRACKING_EVENT_CREATE', 'tracking_events', $2, $3, $4, $5)
      `,
      [
        user_id || null,
        event.id,
        shipment.platform_tracking_no,
        JSON.stringify({ event_code: eventCode, resulting_status: resultingStatus, tracking_no: shipment.tracking_no, external_ref }),
        ip_address || null,
      ]
    );
  }

  return { event, shipment, ignored: false, duplicate: false };
}

export const trackingEventsService = {
  aggregateShipmentStatus,
  createEvent,
};

export async function refreshShipmentFromTrackingEvents(shipmentId, db = { query }) {
  return applyShipmentAggregation(shipmentId, {}, db);
}

export function trackingEventToLegacyTimeline(event) {
  return {
    id: event.id,
    shipment_id: event.shipment_id,
    event_type: event.resulting_status || statusFromEventCode(event.event_code) || event.event_type,
    event_code: event.event_code,
    event_time: event.event_time,
    location: event.event_city,
    remark: event.event_description,
    source: event.source_type,
    created_by: event.operator_id,
    created_at: event.created_at,
    operator_name: event.operator_name,
  };
}




