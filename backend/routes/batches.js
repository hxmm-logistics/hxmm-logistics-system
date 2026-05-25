import express from 'express';
import { pool, query } from '../db.js';
import { authenticateToken } from '../auth.js';
import { createEvent } from '../services/trackingEvents.js';
import { renderBatchManifestHtml } from '../services/manifestService.js';

export const batchesRouter = express.Router();

const BATCH_UPDATE_FIELDS = [
  'driver_name',
  'driver_phone',
  'vehicle_number',
  'vehicle_type',
  'departure_warehouse',
  'arrival_warehouse',
  'route_id',
];

function success(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ success: false, error, ...extra });
}

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeShipmentIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => parseId(id)).filter(Boolean))];
}

function operatorIdFromUser(user) {
  return user?.operator_id || user?.id || null;
}
async function createBatchTrackingEvents({ batch, shipmentIds, eventCode, eventCity, eventDescription, externalRefPrefix, user, ipAddress }, db) {
  let createdCount = 0;
  const results = [];

  for (const shipmentId of shipmentIds) {
    const result = await createEvent(
      {
        shipment_id: shipmentId,
        event_code: eventCode,
        event_city: eventCity || '',
        event_description: eventDescription,
        source_type: 'system',
        external_ref: `${externalRefPrefix}-${batch.id}-${shipmentId}`,
        external_payload: {
          source_type: 'batch',
          batch_id: batch.id,
          batch_number: batch.batch_number,
          batch_status: batch.status,
        },
        operator_id: operatorIdFromUser(user),
        user_id: user?.id || null,
        ip_address: ipAddress,
      },
      db
    );

    if (!result.ignored) createdCount += 1;
    results.push({
      shipment_id: shipmentId,
      event_id: result.event?.id || null,
      created: !result.ignored,
      duplicate: Boolean(result.duplicate),
    });
  }

  return { createdCount, results };
}

async function getBatchById(id, db = { query }) {
  const result = await db.query('SELECT * FROM batches WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function refreshBatchShipmentCount(batchId, db) {
  const result = await db.query(
    `
      UPDATE batches b
      SET total_shipments = counts.total
      FROM (
        SELECT COUNT(*)::int AS total
        FROM batch_shipments
        WHERE batch_id = $1
      ) counts
      WHERE b.id = $1
      RETURNING b.*
    `,
    [batchId]
  );
  return result.rows[0] || null;
}

batchesRouter.post('/batches', authenticateToken, async (req, res, next) => {
  try {
    const {
      driver_name = null,
      driver_phone = null,
      vehicle_number = null,
      vehicle_type = null,
      departure_warehouse = null,
      arrival_warehouse = null,
      route_id = null,
    } = req.body || {};

    const routeId = route_id === null || route_id === undefined || route_id === '' ? null : parseId(route_id);
    if (route_id !== null && route_id !== undefined && route_id !== '' && !routeId) {
      return fail(res, 400, 'route_id must be a positive integer or null');
    }

    const result = await query(
      `
        INSERT INTO batches (
          batch_number,
          route_id,
          driver_name,
          driver_phone,
          vehicle_number,
          vehicle_type,
          departure_warehouse,
          arrival_warehouse,
          status,
          total_shipments,
          operator_id
        )
        VALUES (generate_batch_number(), $1, $2, $3, $4, $5, $6, $7, 'PENDING', 0, $8)
        RETURNING *
      `,
      [
        routeId,
        driver_name,
        driver_phone,
        vehicle_number,
        vehicle_type,
        departure_warehouse,
        arrival_warehouse,
        operatorIdFromUser(req.user),
      ]
    );

    return success(res, { batch: result.rows[0] }, 201);
  } catch (error) {
    return next(error);
  }
});

batchesRouter.get('/batches', authenticateToken, async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const startDate = req.query.start_date || null;
    const endDate = req.query.end_date || null;

    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (startDate) {
      params.push(startDate);
      where.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (endDate) {
      params.push(endDate);
      where.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await query(`SELECT COUNT(*)::int AS total FROM batches ${whereSql}`, params);

    params.push(limit, offset);
    const listResult = await query(
      `
        SELECT *
        FROM batches
        ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );

    return success(res, {
      batches: listResult.rows,
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


batchesRouter.get('/batches/:id/manifest', authenticateToken, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    const format = String(req.query.format || 'html').toLowerCase();
    if (!['html', 'pdf'].includes(format)) {
      return fail(res, 400, 'format must be html or pdf');
    }

    const batch = await getBatchById(id);
    if (!batch) return fail(res, 404, 'Batch not found');

    const shipmentsResult = await query(
      `
        SELECT
          s.id,
          s.platform_tracking_no,
          s.hx_no,
          s.tracking_no,
          s.china_tracking_no,
          s.carrier_code,
          s.carrier_name,
          s.china_carrier_code,
          s.china_carrier_name,
          s.customer_name,
          s.customer_phone,
          s.current_location,
          s.current_node,
          s.current_status,
          bs.added_at,
          bs.added_by
        FROM batch_shipments bs
        JOIN shipments s ON s.id = bs.shipment_id
        WHERE bs.batch_id = $1
        ORDER BY bs.added_at ASC, bs.id ASC
      `,
      [id]
    );

    const html = renderBatchManifestHtml({ batch, shipments: shipmentsResult.rows });

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${batch.batch_number}-manifest.html"`);
      res.setHeader('X-HXMM-PDF-Mode', 'browser-print');
      return res.send(html);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    return next(error);
  }
});
batchesRouter.get('/batches/:id', authenticateToken, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    const batch = await getBatchById(id);
    if (!batch) return fail(res, 404, 'Batch not found');

    const shipmentsResult = await query(
      `
        SELECT
          s.*,
          bs.added_at,
          bs.added_by
        FROM batch_shipments bs
        JOIN shipments s ON s.id = bs.shipment_id
        WHERE bs.batch_id = $1
        ORDER BY bs.added_at DESC, bs.id DESC
      `,
      [id]
    );

    return success(res, { batch: { ...batch, shipments: shipmentsResult.rows } });
  } catch (error) {
    return next(error);
  }
});

batchesRouter.put('/batches/:id', authenticateToken, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    const updates = [];
    const values = [];

    for (const field of BATCH_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        if (field === 'route_id') {
          const raw = req.body[field];
          const routeId = raw === null || raw === undefined || raw === '' ? null : parseId(raw);
          if (raw !== null && raw !== undefined && raw !== '' && !routeId) {
            return fail(res, 400, 'route_id must be a positive integer or null');
          }
          values.push(routeId);
        } else {
          values.push(req.body[field]);
        }
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (!updates.length) return fail(res, 400, 'No editable fields provided');

    values.push(id);
    const result = await query(
      `
        UPDATE batches
        SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    if (result.rowCount === 0) return fail(res, 404, 'Batch not found');
    return success(res, { batch: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

batchesRouter.delete('/batches/:id', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [id]);
    if (batchResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Batch not found');
    }

    const batch = batchResult.rows[0];
    if (batch.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Only PENDING batches can be deleted');
    }

    const countResult = await client.query('SELECT COUNT(*)::int AS total FROM batch_shipments WHERE batch_id = $1', [id]);
    if ((countResult.rows[0]?.total || 0) > 0) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Batch has shipments. Remove shipments before deleting');
    }

    await client.query('DELETE FROM batches WHERE id = $1', [id]);
    await client.query('COMMIT');
    return success(res, { deleted: true, batch_id: id });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

batchesRouter.post('/batches/:id/add-shipments', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const shipmentIds = normalizeShipmentIds(req.body?.shipment_ids);
    if (!id) return fail(res, 400, 'Invalid batch id');
    if (!shipmentIds.length) return fail(res, 400, 'shipment_ids must be a non-empty array of ids');

    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [id]);
    if (batchResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Batch not found');
    }
    if (batchResult.rows[0].status !== 'PENDING') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Only PENDING batches can be modified');
    }

    const existingShipments = await client.query('SELECT id FROM shipments WHERE id = ANY($1::bigint[])', [shipmentIds]);
    const existingIds = new Set(existingShipments.rows.map((row) => Number(row.id)));
    const missingIds = shipmentIds.filter((shipmentId) => !existingIds.has(shipmentId));
    if (missingIds.length) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Some shipments were not found', { missing_shipment_ids: missingIds });
    }

    const lockedResult = await client.query(
      `
        SELECT shipment_id, batch_id
        FROM batch_shipments
        WHERE shipment_id = ANY($1::bigint[])
          AND batch_id <> $2
      `,
      [shipmentIds, id]
    );
    if (lockedResult.rowCount > 0) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Some shipments are already assigned to another batch', {
        locked_shipments: lockedResult.rows,
      });
    }

    const insertResult = await client.query(
      `
        INSERT INTO batch_shipments (batch_id, shipment_id, added_by)
        SELECT $1, unnest($2::bigint[]), $3
        ON CONFLICT (batch_id, shipment_id) DO NOTHING
        RETURNING shipment_id
      `,
      [id, shipmentIds, operatorIdFromUser(req.user)]
    );

    const batch = await refreshBatchShipmentCount(id, client);
    await client.query('COMMIT');

    return success(res, {
      batch,
      added_count: insertResult.rowCount,
      added_shipment_ids: insertResult.rows.map((row) => Number(row.shipment_id)),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

batchesRouter.post('/batches/:id/remove-shipments', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const shipmentIds = normalizeShipmentIds(req.body?.shipment_ids);
    if (!id) return fail(res, 400, 'Invalid batch id');
    if (!shipmentIds.length) return fail(res, 400, 'shipment_ids must be a non-empty array of ids');

    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [id]);
    if (batchResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Batch not found');
    }
    if (batchResult.rows[0].status !== 'PENDING') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Only PENDING batches can be modified');
    }

    const deleteResult = await client.query(
      `
        DELETE FROM batch_shipments
        WHERE batch_id = $1
          AND shipment_id = ANY($2::bigint[])
        RETURNING shipment_id
      `,
      [id, shipmentIds]
    );

    const batch = await refreshBatchShipmentCount(id, client);
    await client.query('COMMIT');

    return success(res, {
      batch,
      removed_count: deleteResult.rowCount,
      removed_shipment_ids: deleteResult.rows.map((row) => Number(row.shipment_id)),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

batchesRouter.post('/batches/:id/depart', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [id]);
    if (batchResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Batch not found');
    }

    const currentBatch = batchResult.rows[0];
    if (currentBatch.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Only PENDING batches can depart');
    }
    if (!currentBatch.total_shipments || currentBatch.total_shipments <= 0) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Batch must contain at least one shipment before departure');
    }

    const shipmentResult = await client.query(
      `
        SELECT shipment_id
        FROM batch_shipments
        WHERE batch_id = $1
        ORDER BY id ASC
      `,
      [id]
    );
    const shipmentIds = shipmentResult.rows.map((row) => Number(row.shipment_id));
    if (!shipmentIds.length) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Batch must contain at least one shipment before departure');
    }

    const updatedBatchResult = await client.query(
      `
        UPDATE batches
        SET status = 'DEPARTED', departure_time = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    const batch = updatedBatchResult.rows[0];

    const eventResult = await createBatchTrackingEvents(
      {
        batch,
        shipmentIds,
        eventCode: 'CHINA_DEPART',
        eventCity: batch.departure_warehouse,
        eventDescription: `批次发车：${batch.batch_number}`,
        externalRefPrefix: 'batch-depart',
        user: req.user,
        ipAddress: req.ip,
      },
      client
    );

    await client.query('COMMIT');
    return success(res, { batch, events_created: eventResult.createdCount, event_results: eventResult.results });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

batchesRouter.post('/batches/:id/arrive', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'Invalid batch id');

    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [id]);
    if (batchResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Batch not found');
    }

    const currentBatch = batchResult.rows[0];
    if (currentBatch.status !== 'DEPARTED') {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Only DEPARTED batches can arrive');
    }
    if (!currentBatch.total_shipments || currentBatch.total_shipments <= 0) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Batch must contain at least one shipment before arrival');
    }

    const shipmentResult = await client.query(
      `
        SELECT shipment_id
        FROM batch_shipments
        WHERE batch_id = $1
        ORDER BY id ASC
      `,
      [id]
    );
    const shipmentIds = shipmentResult.rows.map((row) => Number(row.shipment_id));
    if (!shipmentIds.length) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'Batch must contain at least one shipment before arrival');
    }

    const updatedBatchResult = await client.query(
      `
        UPDATE batches
        SET status = 'ARRIVED', arrival_time = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    const batch = updatedBatchResult.rows[0];

    const eventResult = await createBatchTrackingEvents(
      {
        batch,
        shipmentIds,
        eventCode: 'MYANMAR_ARRIVE',
        eventCity: batch.arrival_warehouse,
        eventDescription: `批次到达：${batch.batch_number}`,
        externalRefPrefix: 'batch-arrive',
        user: req.user,
        ipAddress: req.ip,
      },
      client
    );

    await client.query('COMMIT');
    return success(res, { batch, events_created: eventResult.createdCount, event_results: eventResult.results });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

