import express from 'express';
import { pool, query } from '../db.js';
import { authenticateToken, requireRole } from '../auth.js';
import { assertSource, assertStatus, assertTransition } from '../status.js';
import { generateTrackingNo } from '../services/trackingNumber.js';
import { syncOneChinaShipment } from '../services/syncChina.js';

export const shipmentsRouter = express.Router();

async function getShipmentWithEvents(trackingNo) {
  const shipmentResult = await query(
    'SELECT * FROM shipments WHERE platform_tracking_no = $1',
    [trackingNo]
  );

  if (shipmentResult.rowCount === 0) {
    return null;
  }

  const shipment = shipmentResult.rows[0];
  const eventsResult = await query(
    `
      SELECT e.*, o.name AS operator_name
      FROM shipment_events e
      LEFT JOIN operators o ON o.id = e.created_by
      WHERE e.shipment_id = $1
      ORDER BY e.event_time DESC, e.id DESC
    `,
    [shipment.id]
  );

  return {
    ...shipment,
    service: 'HX MM',
    tracking_no: shipment.platform_tracking_no,
    estimated_arrival: estimateArrival(shipment.current_status),
    support_contact: '+95 900000000',
    events: eventsResult.rows,
  };
}

function estimateArrival(status) {
  if (status === 'DELIVERED') return '已签收';
  if (status === 'OUT_FOR_DELIVERY') return '预计今日送达';
  if (status === 'IN_MYANMAR') return '预计 1-3 天送达';
  if (status === 'AT_BORDER' || status === 'CUSTOMS') return '预计 3-5 天送达';
  return '预计 5-7 天送达';
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

async function appendEvent({ trackingNo, eventType, location, remark, source, createdBy, userId, ipAddress }) {
  assertStatus(eventType);
  assertSource(source);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const shipmentResult = await client.query(
      'SELECT * FROM shipments WHERE platform_tracking_no = $1 FOR UPDATE',
      [trackingNo]
    );

    if (shipmentResult.rowCount === 0) {
      const error = new Error('Shipment not found');
      error.status = 404;
      throw error;
    }

    const shipment = shipmentResult.rows[0];

    if (shipment.current_status === 'DELIVERED' && eventType === 'DELIVERED') {
      await client.query('COMMIT');
      await logOperation({
        userId,
        action: 'SHIPMENT_EVENT_IGNORED',
        entityType: 'shipments',
        entityId: shipment.id,
        platformTrackingNo: trackingNo,
        detail: { reason: 'delivered_idempotent', event_type: eventType },
        ipAddress,
      });
      return { data: await getShipmentWithEvents(trackingNo), statusCode: 200, ignored: true };
    }

    assertTransition(shipment.current_status, eventType);

    await client.query(
      `
        INSERT INTO shipment_events (shipment_id, event_type, location, remark, source, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [shipment.id, eventType, location, remark || null, source, createdBy || null]
    );

    await client.query(
      `
        INSERT INTO shipment_status_logs (
          shipment_id,
          from_status,
          to_status,
          location,
          source,
          remark,
          changed_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [shipment.id, shipment.current_status, eventType, location, source, remark || null, userId || null]
    );

    await client.query(
      `
        UPDATE shipments
        SET current_status = $1,
            current_location = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [eventType, location, shipment.id]
    );

    await client.query('COMMIT');
    await logOperation({
      userId,
      action: 'SHIPMENT_STATUS_UPDATE',
      entityType: 'shipments',
      entityId: shipment.id,
      platformTrackingNo: trackingNo,
      detail: { from_status: shipment.current_status, to_status: eventType, location, source },
      ipAddress,
    });
    return { data: await getShipmentWithEvents(trackingNo), statusCode: 201, ignored: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

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

    const trackingNo = await generateTrackingNo();

    const shipmentResult = await query(
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9)
        RETURNING *
      `,
      [
        trackingNo,
        china_carrier_code || null,
        china_carrier_name || null,
        china_tracking_no || null,
        customer_name,
        customer_phone,
        origin_country,
        destination_country,
        current_location,
      ]
    );

    await query(
      `
        INSERT INTO shipment_events (shipment_id, event_type, location, remark, source, created_by)
        VALUES ($1, 'PENDING', $2, '包裹已创建', 'system', $3)
      `,
      [shipmentResult.rows[0].id, current_location, created_by]
    );

    if (china_carrier_code && china_tracking_no) {
      await syncOneChinaShipment(shipmentResult.rows[0]);
    }

    await logOperation({
      userId: req.user.id,
      action: 'SHIPMENT_CREATE',
      entityType: 'shipments',
      entityId: shipmentResult.rows[0].id,
      platformTrackingNo: trackingNo,
      detail: { china_carrier_code, china_tracking_no, customer_phone },
      ipAddress: req.ip,
    });

    res.status(201).json(await getShipmentWithEvents(trackingNo));
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.get('/shipment/:tracking_no', async (req, res, next) => {
  try {
    const data = await getShipmentWithEvents(req.params.tracking_no);
    if (!data) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.json(data);
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.post('/shipment/:tracking_no/event', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const { event_type, location, remark, source = 'manual' } = req.body;
    if (!event_type || !location) {
      return res.status(400).json({ error: 'event_type and location are required' });
    }

    const result = await appendEvent({
      trackingNo: req.params.tracking_no,
      eventType: event_type,
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
      arrived_muse: {
        eventType: 'IN_MYANMAR',
        location: '木姐',
        remark: '缅甸物流扫码接货',
      },
      arrived_mandalay: {
        eventType: 'IN_MYANMAR',
        location: '曼德勒',
        remark: '包裹已到达曼德勒分拨点',
      },
      out_for_delivery: {
        eventType: 'OUT_FOR_DELIVERY',
        location: '派送中',
        remark: '包裹正在派送',
      },
      delivered: {
        eventType: 'DELIVERED',
        location: '客户已签收',
        remark: '签收完成',
      },
    };

    if (!actionMap[action]) {
      return res.status(400).json({ error: 'Invalid scan action' });
    }

    const mapped = actionMap[action];
    const result = await appendEvent({
      trackingNo: req.params.tracking_no,
      eventType: mapped.eventType,
      location: mapped.location,
      remark: mapped.remark,
      source: 'myanmar_scan',
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
        SELECT *, platform_tracking_no AS tracking_no
        FROM shipments
        WHERE (
             platform_tracking_no ILIKE $1
          OR china_tracking_no ILIKE $1
          OR china_carrier_code ILIKE $1
          OR customer_phone ILIKE $1
        )
          AND ($2::text IS NULL OR current_status = $2)
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
    const shipment = await query(
      'SELECT id, platform_tracking_no FROM shipments WHERE platform_tracking_no = $1',
      [req.params.tracking_no]
    );

    if (shipment.rowCount === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const statusLogs = await query(
      `
        SELECT l.*, u.username, u.display_name
        FROM shipment_status_logs l
        LEFT JOIN users u ON u.id = l.changed_by
        WHERE l.shipment_id = $1
        ORDER BY l.created_at DESC, l.id DESC
      `,
      [shipment.rows[0].id]
    );

    const operationLogs = await query(
      `
        SELECT l.*, u.username, u.display_name
        FROM operation_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.platform_tracking_no = $1
        ORDER BY l.created_at DESC, l.id DESC
      `,
      [req.params.tracking_no]
    );

    res.json({
      service: 'HX MM',
      platform_tracking_no: req.params.tracking_no,
      status_logs: statusLogs.rows,
      operation_logs: operationLogs.rows,
    });
  } catch (error) {
    next(error);
  }
});
