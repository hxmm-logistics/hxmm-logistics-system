import express from 'express';
import { pool, query } from '../db.js';
import { authenticateToken, requireRole } from '../auth.js';
import { createEvent } from '../services/trackingEvents.js';

export const exceptionsRouter = express.Router();

const EXCEPTION_TYPES = new Set([
  'LOST',
  'DAMAGED',
  'CUSTOMS_HOLD',
  'ADDRESS_ISSUE',
  'CONTACT_ISSUE',
  'REJECTED',
  'DELAY',
  'OTHER',
]);

const EXCEPTION_STATUSES = new Set(['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED']);
const EXCEPTION_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

exceptionsRouter.use('/exceptions', authenticateToken, requireRole(['admin', 'operator']));

function success(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ success: false, error, ...extra });
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeEnum(value, allowed, fieldName, fallback = null) {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  if (!allowed.has(normalized)) {
    const error = new Error(`Invalid ${fieldName}`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function displayName(user) {
  return user?.display_name || user?.username || null;
}

async function logExceptionOperation(client, { userId, action, exceptionId, detail, ipAddress }) {
  await client.query(
    `
      INSERT INTO operation_logs (user_id, action, entity_type, entity_id, detail, ip_address)
      VALUES ($1, $2, 'exceptions', $3, $4, $5)
    `,
    [userId || null, action, exceptionId || null, JSON.stringify(detail || {}), ipAddress || null]
  );
}

async function findExceptionById(id, db = { query }) {
  const result = await db.query(
    `
      SELECT e.*,
             s.tracking_no,
             s.platform_tracking_no,
             s.hx_no,
             s.current_status,
             s.current_location,
             s.current_node,
             b.batch_number
      FROM exceptions e
      JOIN shipments s ON s.id = e.shipment_id
      LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.id = $1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function assertShipmentExists(client, shipmentId) {
  const result = await client.query(
    `
      SELECT id, tracking_no, platform_tracking_no, hx_no, current_status, current_location, current_node
      FROM shipments
      WHERE id = $1
      FOR UPDATE
    `,
    [shipmentId]
  );
  if (result.rowCount === 0) {
    const error = new Error('Shipment not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function assertBatchExists(client, batchId) {
  if (!batchId) return null;
  const result = await client.query('SELECT id, batch_number FROM batches WHERE id = $1', [batchId]);
  if (result.rowCount === 0) {
    const error = new Error('Batch not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

exceptionsRouter.post('/exceptions', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const shipmentId = parseId(req.body?.shipment_id);
    const batchId = req.body?.batch_id === null || req.body?.batch_id === undefined || req.body?.batch_id === ''
      ? null
      : parseId(req.body.batch_id);
    const exceptionType = normalizeEnum(req.body?.exception_type, EXCEPTION_TYPES, 'exception_type');
    const severity = normalizeEnum(req.body?.severity || 'MEDIUM', EXCEPTION_SEVERITIES, 'severity', 'MEDIUM');
    const description = String(req.body?.description || '').trim();

    if (!shipmentId) return fail(res, 400, 'shipment_id is required');
    if (req.body?.batch_id !== null && req.body?.batch_id !== undefined && req.body?.batch_id !== '' && !batchId) {
      return fail(res, 400, 'batch_id must be a positive integer or null');
    }
    if (!description) return fail(res, 400, 'description is required');

    await client.query('BEGIN');
    const shipment = await assertShipmentExists(client, shipmentId);
    const batch = await assertBatchExists(client, batchId);

    const exceptionResult = await client.query(
      `
        INSERT INTO exceptions (
          shipment_id,
          batch_id,
          exception_type,
          status,
          severity,
          description,
          reporter_id,
          reporter_name
        )
        VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7)
        RETURNING *
      `,
      [shipmentId, batchId, exceptionType, severity, description, req.user.id, displayName(req.user)]
    );
    const exception = exceptionResult.rows[0];

    const eventResult = await createEvent(
      {
        shipment_id: shipmentId,
        event_code: 'EXCEPTION_REPORT',
        event_city: shipment.current_node || shipment.current_location || '',
        event_description: `异常上报：${exceptionType} - ${description}`,
        source_type: 'admin',
        external_ref: `exception-report-${exception.id}`,
        external_payload: {
          exception_id: exception.id,
          exception_type: exceptionType,
          severity,
          batch_id: batch?.id || null,
          batch_number: batch?.batch_number || null,
        },
        operator_id: req.user.id,
        user_id: req.user.id,
        ip_address: req.ip,
      },
      client
    );

    await logExceptionOperation(client, {
      userId: req.user.id,
      action: 'EXCEPTION_REPORT',
      exceptionId: exception.id,
      detail: {
        shipment_id: shipmentId,
        tracking_no: shipment.tracking_no || shipment.platform_tracking_no || shipment.hx_no,
        batch_id: batchId,
        exception_type: exceptionType,
        severity,
        tracking_event_id: eventResult.event?.id || null,
      },
      ipAddress: req.ip,
    });

    await client.query('COMMIT');
    return success(res, { exception, tracking_event: eventResult.event }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

exceptionsRouter.get('/exceptions', async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status ? normalizeEnum(req.query.status, EXCEPTION_STATUSES, 'status') : null;
    const exceptionType = req.query.exception_type ? normalizeEnum(req.query.exception_type, EXCEPTION_TYPES, 'exception_type') : null;
    const severity = req.query.severity ? normalizeEnum(req.query.severity, EXCEPTION_SEVERITIES, 'severity') : null;
    const shipmentId = req.query.shipment_id ? parseId(req.query.shipment_id) : null;
    const batchId = req.query.batch_id ? parseId(req.query.batch_id) : null;

    const params = [];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`e.status = $${params.length}`);
    }
    if (exceptionType) {
      params.push(exceptionType);
      where.push(`e.exception_type = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      where.push(`e.severity = $${params.length}`);
    }
    if (shipmentId) {
      params.push(shipmentId);
      where.push(`e.shipment_id = $${params.length}`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(`e.batch_id = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await query(`SELECT COUNT(*)::int AS total FROM exceptions e ${whereSql}`, params);
    params.push(limit, offset);
    const result = await query(
      `
        SELECT e.*,
               s.tracking_no,
               s.platform_tracking_no,
               s.hx_no,
               s.current_status,
               b.batch_number
        FROM exceptions e
        JOIN shipments s ON s.id = e.shipment_id
        LEFT JOIN batches b ON b.id = e.batch_id
        ${whereSql}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );

    return success(res, {
      exceptions: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

exceptionsRouter.get('/exceptions/open', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT e.*,
               s.tracking_no,
               s.platform_tracking_no,
               s.hx_no,
               s.current_status,
               b.batch_number
        FROM exceptions e
        JOIN shipments s ON s.id = e.shipment_id
        LEFT JOIN batches b ON b.id = e.batch_id
        WHERE e.status IN ('PENDING', 'PROCESSING')
        ORDER BY
          CASE e.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          e.created_at ASC,
          e.id ASC
        LIMIT 100
      `
    );
    return success(res, { exceptions: result.rows });
  } catch (error) {
    return next(error);
  }
});

exceptionsRouter.get('/exceptions/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid exception id');

    const exception = await findExceptionById(id);
    if (!exception) return fail(res, 404, 'Exception not found');
    return success(res, { exception });
  } catch (error) {
    return next(error);
  }
});

async function updateExceptionStatus(req, res, next, { nextStatus, action, timestampColumn = null, requireCurrent = [] }) {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid exception id');

    const note = req.body?.note ? String(req.body.note).trim() : null;
    await client.query('BEGIN');

    const locked = await client.query('SELECT * FROM exceptions WHERE id = $1 FOR UPDATE', [id]);
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Exception not found');
    }

    const current = locked.rows[0];
    if (requireCurrent.length && !requireCurrent.includes(current.status)) {
      await client.query('ROLLBACK');
      return fail(res, 409, `Exception status must be one of: ${requireCurrent.join(', ')}`);
    }

    const updates = ['status = $1', 'handler_id = $2', 'handler_name = $3'];
    const values = [nextStatus, req.user.id, displayName(req.user)];
    if (timestampColumn) {
      updates.push(`${timestampColumn} = NOW()`);
    }
    values.push(id);

    const result = await client.query(
      `
        UPDATE exceptions
        SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    await logExceptionOperation(client, {
      userId: req.user.id,
      action,
      exceptionId: id,
      detail: {
        from_status: current.status,
        to_status: nextStatus,
        note,
      },
      ipAddress: req.ip,
    });

    await client.query('COMMIT');
    return success(res, { exception: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

exceptionsRouter.post('/exceptions/:id/process', (req, res, next) => updateExceptionStatus(req, res, next, {
  nextStatus: 'PROCESSING',
  action: 'EXCEPTION_PROCESS',
  requireCurrent: ['PENDING'],
}));

exceptionsRouter.post('/exceptions/:id/resolve', (req, res, next) => updateExceptionStatus(req, res, next, {
  nextStatus: 'RESOLVED',
  action: 'EXCEPTION_RESOLVE',
  timestampColumn: 'resolved_at',
  requireCurrent: ['PENDING', 'PROCESSING'],
}));

exceptionsRouter.post('/exceptions/:id/close', (req, res, next) => updateExceptionStatus(req, res, next, {
  nextStatus: 'CLOSED',
  action: 'EXCEPTION_CLOSE',
  timestampColumn: 'closed_at',
  requireCurrent: ['RESOLVED'],
}));
