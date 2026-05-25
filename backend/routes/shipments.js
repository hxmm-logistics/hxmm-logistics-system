import express from 'express';
import { pool, query } from '../db.js';
import { authenticateToken, requireRole } from '../auth.js';
import { normalizeStatus } from '../status.js';
import { detectCarrier, normalizeTrackingNo } from '../services/carrier.js';
import { generateTrackingNo } from '../services/trackingNumber.js';
import { syncOneChinaShipment } from '../services/syncChina.js';
import {
  createEvent,
  listTrackingEvents,
  normalizeTrackingEventCode,
  statusFromEventCode,
  trackingEventToLegacyTimeline,
} from '../services/trackingEvents.js';

export const shipmentsRouter = express.Router();

function estimateArrival(status) {
  if (status === 'DELIVERED') return '已签收';
  if (status === 'OUT_FOR_DELIVERY') return '预计今日送达';
  if (status === 'MYANMAR_TRANSIT') return '预计 1-3 天送达';
  if (status === 'AT_BORDER' || status === 'CUSTOMS_CLEARANCE') return '预计 3-5 天送达';
  return '预计 5-7 天送达';
}

function normalizeShipmentRow(shipment) {
  const hxNo = shipment.hx_no || shipment.platform_tracking_no;
  const publicTrackingNo = shipment.tracking_no || shipment.china_tracking_no || shipment.platform_tracking_no;
  return {
    ...shipment,
    hx_no: hxNo,
    platform_tracking_no: shipment.platform_tracking_no || hxNo,
    tracking_no: publicTrackingNo,
    carrier_code: shipment.carrier_code || shipment.china_carrier_code || 'UNKNOWN',
    carrier_name: shipment.carrier_name || shipment.china_carrier_name || '未识别物流公司',
    status: shipment.current_status || shipment.status,
    current_node: shipment.current_node || shipment.current_location,
  };
}

function toPublicEvent(event) {
  const eventCode = event.event_code || normalizeTrackingEventCode(event.event_type);
  const resultingStatus = event.resulting_status || statusFromEventCode(eventCode) || normalizeStatus(event.event_type);
  return {
    id: event.id,
    event_code: eventCode,
    event_type: resultingStatus,
    status: resultingStatus,
    event_description: event.event_description,
    event_city: event.event_city,
    event_time: event.event_time,
    source_type: event.source_type,
  };
}

function toPublicTrackResponse(shipment, trackingEvents = []) {
  const row = normalizeShipmentRow(shipment);
  const currentStatus = row.current_status;
  const publicTimeline = trackingEvents.map(toPublicEvent);
  const latestEvent = publicTimeline[0] || null;
  const carrier = {
    code: row.carrier_code,
    name: row.carrier_name,
  };
  return {
    tracking_no: row.tracking_no,
    carrier,
    carrier_code: carrier.code,
    carrier_name: carrier.name,
    current_status: currentStatus,
    status: currentStatus,
    current_city: latestEvent?.event_city || row.current_node,
    current_node: latestEvent?.event_city || row.current_node,
    latest_event: latestEvent,
    timeline: publicTimeline,
    inbound_at: row.inbound_at,
    outbound_at: row.outbound_at,
    delivered_at: row.delivered_at,
    updated_at: latestEvent?.event_time || row.updated_at,
    estimated_delivery: estimateArrival(currentStatus),
    has_departed: Boolean(row.outbound_at),
    arrived_myanmar: ['MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(currentStatus),
    delivered: currentStatus === 'DELIVERED' || Boolean(row.delivered_at),
  };
}

async function findShipmentByAnyTrackingNo(trackingNo, client = null, lock = false) {
  const db = client || { query };
  const normalized = normalizeTrackingNo(trackingNo);
  const result = await db.query(
    `
      SELECT *
      FROM shipments
      WHERE platform_tracking_no = $1
         OR hx_no = $1
         OR tracking_no = $1
         OR china_tracking_no = $1
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [normalized]
  );
  return result.rowCount ? normalizeShipmentRow(result.rows[0]) : null;
}

async function getShipmentWithEvents(trackingNo) {
  const shipment = await findShipmentByAnyTrackingNo(trackingNo);
  if (!shipment) return null;

  const trackingEvents = await listTrackingEvents(shipment.id);
  const events = trackingEvents.map(trackingEventToLegacyTimeline);

  return {
    ...shipment,
    service: 'HX MM',
    estimated_arrival: estimateArrival(shipment.current_status),
    support_contact: '+95 900000000',
    events,
    tracking_events: trackingEvents,
  };
}

async function logOperation({ userId, action, entityType, entityId, platformTrackingNo, detail, ipAddress }) {
  await query(
    `
      INSERT INTO operation_logs (user_id, action, entity_type, entity_id, platform_tracking_no, detail, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [userId || null, action, entityType, entityId || null, platformTrackingNo || null, JSON.stringify(detail || {}), ipAddress || null]
  );
}

async function appendEvent({ trackingNo, eventCode, eventType, location, remark, source, createdBy, userId, ipAddress }) {
  const normalizedEventCode = normalizeTrackingEventCode(eventCode || eventType);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await createEvent(
      {
        tracking_no: trackingNo,
        event_code: normalizedEventCode,
        event_city: location,
        event_description: remark || normalizedEventCode,
        source_type: source,
        external_payload: { compatibility_source: source, created_by: createdBy || null },
        operator_id: userId || null,
        user_id: userId || null,
        ip_address: ipAddress,
      },
      client
    );
    await client.query('COMMIT');

    const shipment = result.shipment;
    return {
      data: await getShipmentWithEvents(shipment.platform_tracking_no),
      statusCode: result.ignored ? 200 : 201,
      ignored: result.ignored,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

shipmentsRouter.post('/tracking_events', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      shipment_id,
      tracking_no,
      event_code,
      event_type,
      event_description,
      event_city,
      location,
      source_type = req.user.role === 'admin' ? 'admin' : 'scan',
      event_time,
      external_ref,
      external_payload = {},
    } = req.body;

    const normalizedEventCode = normalizeTrackingEventCode(event_code || event_type);
    const city = event_city || location;
    if (!normalizedEventCode || !city) {
      return res.status(400).json({ success: false, error: 'event_code and event_city are required' });
    }

    await client.query('BEGIN');
    const result = await createEvent(
      {
        shipment_id,
        tracking_no,
        event_code: normalizedEventCode,
        event_city: city,
        event_description: event_description || normalizedEventCode,
        source_type,
        event_time: event_time || null,
        external_ref,
        external_payload,
        operator_id: req.user.id,
        user_id: req.user.id,
        ip_address: req.ip,
      },
      client
    );
    await client.query('COMMIT');

    return res.status(result.ignored ? 200 : 201).json({
      success: true,
      ignored: result.ignored,
      duplicate: result.duplicate,
      event: result.event,
      shipment: await getShipmentWithEvents(result.shipment.platform_tracking_no),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

shipmentsRouter.get('/track/query', async (req, res, next) => {
  try {
    const trackingNo = normalizeTrackingNo(req.query.tracking_no);
    if (!trackingNo) return res.status(400).json({ success: false, error: '请输入物流单号' });
    if (/^HX\d{8,}/i.test(trackingNo)) {
      return res.status(404).json({ success: false, error: '未查询到包裹' });
    }

    const shipment = await findShipmentByAnyTrackingNo(trackingNo);
    if (!shipment || shipment.tracking_no !== trackingNo) {
      return res.status(404).json({ success: false, error: '未查询到包裹' });
    }
    const trackingEvents = await listTrackingEvents(shipment.id);

    const publicShipment = toPublicTrackResponse(shipment, trackingEvents);
    res.json({
      success: true,
      shipment: publicShipment,
      latest_event: publicShipment.latest_event,
      timeline: publicShipment.timeline,
      current_city: publicShipment.current_city,
      estimated_delivery: publicShipment.estimated_delivery,
      carrier: publicShipment.carrier,
    });
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.post('/shipments/inbound-scan', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const trackingNo = normalizeTrackingNo(req.body.tracking_no);
    const warehouseId = req.body.warehouse_id ? Number(req.body.warehouse_id) : null;
    const warehouseName = req.body.warehouse_name || '中国仓';
    const currentNode = req.body.current_node || `${warehouseName}已入库`;
    const operatorUserId = req.user.id;
    const operatorId = req.user.operator_id;

    if (!trackingNo) return res.status(400).json({ success: false, error: 'tracking_no is required' });

    const carrier = detectCarrier(trackingNo);
    await client.query('BEGIN');

    const existingResult = await client.query('SELECT * FROM shipments WHERE tracking_no = $1 FOR UPDATE', [trackingNo]);
    if (existingResult.rowCount > 0) {
      const existing = normalizeShipmentRow(existingResult.rows[0]);
      await client.query('COMMIT');
      await logOperation({
        userId: operatorUserId,
        action: 'SHIPMENT_INBOUND_DUPLICATE_SCAN',
        entityType: 'shipments',
        entityId: existing.id,
        platformTrackingNo: existing.platform_tracking_no,
        detail: { tracking_no: trackingNo },
        ipAddress: req.ip,
      });
      return res.status(200).json({ success: true, created: false, duplicate: true, shipment: existing });
    }

    const hxNo = await generateTrackingNo();
    const shipmentResult = await client.query(
      `
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
          current_node,
          operator_id,
          warehouse_id,
          inbound_at
        )
        VALUES ($1, $1, $2, $3, $4, $3, $4, $2, '未登记', '未登记', 'China', 'Myanmar', $5, $5, $6, $7, NOW())
        RETURNING *
      `,
      [hxNo, trackingNo, carrier.carrier_code, carrier.carrier_name, currentNode, operatorUserId, warehouseId]
    );

    const shipment = normalizeShipmentRow(shipmentResult.rows[0]);



    await createEvent(
      {
        shipment_id: shipment.id,
        tracking_no: trackingNo,
        event_code: 'WAREHOUSE_RECEIVE',
        event_description: '操作员扫码入库',
        event_city: currentNode,
        source_type: 'scan',
        external_ref: `inbound:${trackingNo}`,
        external_payload: { workflow: 'inbound_scan', tracking_no: trackingNo },
        operator_id: operatorUserId,
        user_id: operatorUserId,
        ip_address: req.ip,
      },
      client
    );

    await client.query('COMMIT');
    await logOperation({
      userId: operatorUserId,
      action: 'SHIPMENT_INBOUND_SCAN_CREATE',
      entityType: 'shipments',
      entityId: shipment.id,
      platformTrackingNo: hxNo,
      detail: { tracking_no: trackingNo, carrier, warehouse_id: warehouseId, current_node: currentNode },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, created: true, shipment: await getShipmentWithEvents(hxNo) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ success: false, error: '物流单号已存在' });
    next(error);
  } finally {
    client.release();
  }
});

shipmentsRouter.post('/shipment/create', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const {
      china_tracking_no,
      china_carrier_code,
      china_carrier_name,
      customer_name,
      customer_phone,
      origin_country = 'China',
      destination_country = 'Myanmar',
      current_location = '中国卖家已创建',
      created_by = req.user.operator_id,
    } = req.body;

    if (!customer_name || !customer_phone) {
      return res.status(400).json({ error: 'customer_name and customer_phone are required' });
    }

    const hxNo = await generateTrackingNo();
    const normalizedChinaTrackingNo = normalizeTrackingNo(china_tracking_no || hxNo);
    const detected = detectCarrier(normalizedChinaTrackingNo);
    const carrierCode = china_carrier_code || detected.carrier_code;
    const carrierName = china_carrier_name || detected.carrier_name;

    const shipmentResult = await query(
      `
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
          current_node,
          inbound_at
        )
        VALUES ($1, $1, $2, $3, $4, $3, $4, $2, $5, $6, $7, $8, $9, $9, NOW())
        RETURNING *
      `,
      [hxNo, normalizedChinaTrackingNo, carrierCode, carrierName, customer_name, customer_phone, origin_country, destination_country, current_location]
    );


    await createEvent({
      shipment_id: shipmentResult.rows[0].id,
      tracking_no: normalizedChinaTrackingNo,
      event_code: 'WAREHOUSE_RECEIVE',
      event_description: '包裹已创建',
      event_city: current_location,
      source_type: 'admin',
      external_ref: `create:${hxNo}`,
      external_payload: { workflow: 'shipment_create', tracking_no: normalizedChinaTrackingNo },
      operator_id: req.user.id,
      user_id: req.user.id,
      ip_address: req.ip,
    });

    if (carrierCode && normalizedChinaTrackingNo && normalizedChinaTrackingNo !== hxNo) {
      await syncOneChinaShipment(shipmentResult.rows[0]);
    }

    await logOperation({
      userId: req.user.id,
      action: 'SHIPMENT_CREATE',
      entityType: 'shipments',
      entityId: shipmentResult.rows[0].id,
      platformTrackingNo: hxNo,
      detail: { carrier_code: carrierCode, tracking_no: normalizedChinaTrackingNo, customer_phone },
      ipAddress: req.ip,
    });

    res.status(201).json(await getShipmentWithEvents(hxNo));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '物流单号已存在' });
    next(error);
  }
});

shipmentsRouter.get('/shipment/:tracking_no', async (req, res, next) => {
  try {
    const data = await getShipmentWithEvents(req.params.tracking_no);
    if (!data) return res.status(404).json({ error: 'Shipment not found' });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.post('/shipment/:tracking_no/event', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const { event_code, event_type, location, remark, source = req.user.role === 'admin' ? 'admin' : 'scan' } = req.body;
    const code = event_code || event_type;
    if (!code || !location) return res.status(400).json({ error: 'event_code and location are required' });

    const result = await appendEvent({
      trackingNo: req.params.tracking_no,
      eventCode: code,
      location,
      remark,
      source,
      createdBy: req.user.operator_id,
      userId: req.user.id,
      ipAddress: req.ip,
    });

    res.status(result.statusCode).json(result.data);
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.post('/shipment/:tracking_no/scan-update', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const { action } = req.body;
    const actionMap = {
      china_depart: { eventCode: 'CHINA_DEPART', location: '中国仓', remark: '中国仓发车' },
      arrived_border: { eventCode: 'BORDER_ARRIVE', location: '瑞丽 / 木姐边境', remark: '包裹已到达边境' },
      customs_clear: { eventCode: 'CUSTOMS_CLEAR', location: '木姐口岸', remark: '包裹清关中' },
      arrived_muse: { eventCode: 'MYANMAR_ARRIVE', location: '木姐', remark: '缅甸物流扫码接货' },
      arrived_mandalay: { eventCode: 'MYANMAR_ARRIVE', location: '曼德勒', remark: '包裹已到达曼德勒分拨点' },
      out_for_delivery: { eventCode: 'DISPATCH', location: '派送中', remark: '包裹正在派送' },
      delivered: { eventCode: 'DELIVER', location: '客户已签收', remark: '签收完成' },
    };

    if (!actionMap[action]) return res.status(400).json({ error: 'Invalid scan action' });

    const mapped = actionMap[action];
    const result = await appendEvent({
      trackingNo: req.params.tracking_no,
      eventCode: mapped.eventCode,
      location: mapped.location,
      remark: mapped.remark,
      source: 'scan',
      createdBy: req.user.operator_id,
      userId: req.user.id,
      ipAddress: req.ip,
    });

    res.status(result.statusCode).json(result.data);
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.get('/admin/shipments', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const status = req.query.status || null;
    const result = await query(
      `
        SELECT *,
               COALESCE(hx_no, platform_tracking_no) AS hx_no,
               COALESCE(tracking_no, china_tracking_no, platform_tracking_no) AS tracking_no,
               COALESCE(carrier_code, china_carrier_code, 'UNKNOWN') AS carrier_code,
               COALESCE(carrier_name, china_carrier_name, '未识别物流公司') AS carrier_name,
               COALESCE(status, current_status) AS status,
               COALESCE(current_node, current_location) AS current_node
        FROM shipments
        WHERE (
             platform_tracking_no ILIKE $1
          OR hx_no ILIKE $1
          OR tracking_no ILIKE $1
          OR china_tracking_no ILIKE $1
          OR china_carrier_code ILIKE $1
          OR carrier_code ILIKE $1
          OR customer_phone ILIKE $1
        )
          AND ($2::text IS NULL OR current_status = $2 OR status = $2)
        ORDER BY updated_at DESC
        LIMIT 100
      `,
      [search, status]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.get('/admin/shipments/:tracking_no/logs', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const shipment = await findShipmentByAnyTrackingNo(req.params.tracking_no);
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    const statusLogs = await query(
      `
        SELECT l.*, u.username, u.display_name
        FROM shipment_status_logs l
        LEFT JOIN users u ON u.id = l.changed_by
        WHERE l.shipment_id = $1
        ORDER BY l.created_at DESC, l.id DESC
      `,
      [shipment.id]
    );

    const operationLogs = await query(
      `
        SELECT l.*, u.username, u.display_name
        FROM operation_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.platform_tracking_no = $1
        ORDER BY l.created_at DESC, l.id DESC
      `,
      [shipment.platform_tracking_no]
    );

    res.json({
      service: 'HX MM',
      platform_tracking_no: shipment.platform_tracking_no,
      hx_no: shipment.hx_no,
      tracking_no: shipment.tracking_no,
      status_logs: statusLogs.rows,
      operation_logs: operationLogs.rows,
    });
  } catch (error) {
    next(error);
  }
});







