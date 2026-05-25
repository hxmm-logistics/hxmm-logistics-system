import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRole } from '../auth.js';

export const dashboardRouter = express.Router();

dashboardRouter.get('/dashboard/stats', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const [shipmentStats, statusRows, exceptionOpen, exceptionTypeRows, exceptionSeverityRows, batchRows, deliveryPerf, routePerf, activityRows] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW()))::int AS this_week,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS this_month
        FROM shipments
      `),
      query(`
        SELECT current_status AS status, COUNT(*)::int AS count
        FROM shipments
        GROUP BY current_status
      `),
      query(`
        SELECT COUNT(*)::int AS total_open
        FROM exceptions
        WHERE status IN ('PENDING', 'PROCESSING')
      `),
      query(`
        SELECT exception_type, COUNT(*)::int AS count
        FROM exceptions
        WHERE status IN ('PENDING', 'PROCESSING')
        GROUP BY exception_type
      `),
      query(`
        SELECT severity, COUNT(*)::int AS count
        FROM exceptions
        WHERE status IN ('PENDING', 'PROCESSING')
        GROUP BY severity
      `),
      query(`
        SELECT status, COUNT(*)::int AS count
        FROM batches
        GROUP BY status
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered_count,
          AVG(EXTRACT(EPOCH FROM (delivered_at - inbound_at)) / 3600.0) FILTER (WHERE delivered_at IS NOT NULL AND inbound_at IS NOT NULL) AS avg_delivery_hours,
          COUNT(*) FILTER (WHERE delivered_at IS NOT NULL AND inbound_at IS NOT NULL AND delivered_at <= inbound_at + INTERVAL '5 days')::int AS on_time_count
        FROM shipments
      `),
      query(`
        SELECT
          CONCAT(COALESCE(origin_country, 'China'), '→', COALESCE(destination_country, 'Myanmar')) AS route,
          ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - inbound_at)) / 3600.0))::int AS avg_hours,
          COUNT(*)::int AS count
        FROM shipments
        WHERE delivered_at IS NOT NULL AND inbound_at IS NOT NULL
        GROUP BY route
        ORDER BY count DESC
        LIMIT 5
      `),
      query(`
        SELECT l.created_at AS time,
               l.action AS type,
               l.detail,
               l.platform_tracking_no,
               u.display_name,
               u.username
        FROM operation_logs l
        LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 20
      `),
    ]);

    const officialStatuses = ['CREATED', 'WAREHOUSE_RECEIVED', 'CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE', 'MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'];
    const statusBreakdown = Object.fromEntries(officialStatuses.map((status) => [status, 0]));
    for (const row of statusRows.rows) {
      if (row.status) statusBreakdown[row.status] = row.count;
    }

    const exceptionTypes = ['LOST', 'DAMAGED', 'CUSTOMS_HOLD', 'ADDRESS_ISSUE', 'CONTACT_ISSUE', 'REJECTED', 'DELAY', 'OTHER'];
    const byType = Object.fromEntries(exceptionTypes.map((type) => [type, 0]));
    for (const row of exceptionTypeRows.rows) {
      byType[row.exception_type] = row.count;
    }

    const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const bySeverity = Object.fromEntries(severities.map((severity) => [severity, 0]));
    for (const row of exceptionSeverityRows.rows) {
      bySeverity[row.severity] = row.count;
    }

    const batchStats = { total: 0, pending: 0, departed: 0, arrived: 0, cancelled: 0 };
    for (const row of batchRows.rows) {
      batchStats.total += row.count;
      batchStats[String(row.status || '').toLowerCase()] = row.count;
    }

    const perf = deliveryPerf.rows[0] || {};
    const deliveredCount = Number(perf.delivered_count || 0);
    const onTimeCount = Number(perf.on_time_count || 0);
    const onTimeRate = deliveredCount > 0 ? Number(((onTimeCount / deliveredCount) * 100).toFixed(1)) : 0;
    const avgDeliveryHours = perf.avg_delivery_hours === null ? null : Number(Number(perf.avg_delivery_hours).toFixed(1));

    const recentActivities = activityRows.rows.map((row) => ({
      time: row.time,
      type: row.type,
      description: describeActivity(row),
      user: row.display_name || row.username || 'system',
    }));

    res.json({
      success: true,
      data: {
        shipment_stats: shipmentStats.rows[0] || { total: 0, today: 0, this_week: 0, this_month: 0 },
        status_breakdown: statusBreakdown,
        exception_stats: {
          total_open: exceptionOpen.rows[0]?.total_open || 0,
          by_type: byType,
          by_severity: bySeverity,
        },
        batch_stats: batchStats,
        delivery_performance: {
          on_time_rate: onTimeRate,
          avg_delivery_hours: avgDeliveryHours,
          by_route: routePerf.rows,
        },
        recent_activities: recentActivities,
      },
    });
  } catch (error) {
    next(error);
  }
});

function describeActivity(row) {
  const detail = row.detail || {};
  const trackingNo = row.platform_tracking_no || detail.tracking_no || '';
  if (row.type === 'EXCEPTION_REPORT') return `运单 ${trackingNo || detail.shipment_id || '-'} 上报异常`;
  if (row.type === 'TRACKING_EVENT_CREATE') return `运单 ${trackingNo || '-'} 新增物流事件 ${detail.event_code || ''}`.trim();
  if (row.type === 'SHIPMENT_CREATE') return `创建运单 ${trackingNo || detail.tracking_no || '-'}`;
  if (row.type === 'SHIPMENT_INBOUND_SCAN_CREATE') return `扫码入库 ${detail.tracking_no || trackingNo || '-'}`;
  return `${row.type}${trackingNo ? ` · ${trackingNo}` : ''}`;
}
