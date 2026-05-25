import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRole } from '../auth.js';
import { createEvent } from '../services/trackingEvents.js';

export const batchRouter = express.Router();

batchRouter.post('/tracking_events/batch', authenticateToken, requireRole(['admin', 'operator']), async (req, res, next) => {
  try {
    const { events, source_type = 'scan' } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: 'events array required' });
    }

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const event of events) {
      try {
        const result = await createEvent({
          tracking_no: event.tracking_no,
          event_code: event.event_code || 'WAREHOUSE_RECEIVE',
          event_city: event.event_city,
          event_description: event.event_description,
          source_type,
          external_ref: event.external_ref,
        }, { query });

        results.push({
          tracking_no: event.tracking_no,
          success: true,
          event_id: result.event?.id || null,
          ignored: Boolean(result.ignored),
          duplicate: Boolean(result.duplicate),
        });
        successCount += 1;
      } catch (error) {
        results.push({
          tracking_no: event.tracking_no,
          success: false,
          error: error.message,
          status: error.status || 500,
        });
        failureCount += 1;
      }
    }

    return res.json({
      success: failureCount === 0,
      total: events.length,
      success_count: successCount,
      failure_count: failureCount,
      results,
    });
  } catch (error) {
    return next(error);
  }
});
