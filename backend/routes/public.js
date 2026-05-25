import express from 'express';
import { query } from '../db.js';
import { detectCarrier, normalizeTrackingNo } from '../services/carrier.js';
import {
  EVENT_CODE_TO_STATUS,
  isValidTrackingFormat,
  listTrackingEvents,
  normalizeTrackingEventCode,
  statusFromEventCode,
} from '../services/trackingEvents.js';

export const publicRouter = express.Router();


const EVENT_DESCRIPTION_TRANSLATIONS = {
  zh: {
    WAREHOUSE_RECEIVE: '仓库已收货',
    CHINA_DEPART: '中国发车',
    BORDER_ARRIVE: '到达边境',
    CUSTOMS_CLEAR: '清关完成',
    MYANMAR_ARRIVE: '到达缅甸',
    DISPATCH: '派送中',
    DELIVER: '已签收',
    EXCEPTION_REPORT: '物流异常',
  },
  en: {
    WAREHOUSE_RECEIVE: 'Warehouse received',
    CHINA_DEPART: 'Departed from China',
    BORDER_ARRIVE: 'Arrived at border',
    CUSTOMS_CLEAR: 'Customs cleared',
    MYANMAR_ARRIVE: 'Arrived in Myanmar',
    DISPATCH: 'Out for delivery',
    DELIVER: 'Delivered',
    EXCEPTION_REPORT: 'Logistics exception',
  },
  my: {
    WAREHOUSE_RECEIVE: 'ဂိုဒေါင်လက်ခံပြီး',
    CHINA_DEPART: 'တရုတ်မှ ထွက်ခွာပြီး',
    BORDER_ARRIVE: 'နယ်စပ်သို့ ရောက်ရှိပြီး',
    CUSTOMS_CLEAR: 'အကောက်ခွန်ရှင်းပြီး',
    MYANMAR_ARRIVE: 'မြန်မာသို့ ရောက်ရှိပြီး',
    DISPATCH: 'ပို့ဆောင်နေသည်',
    DELIVER: 'လက်ခံပြီး',
    EXCEPTION_REPORT: 'ပို့ဆောင်ရေး ပြဿနာရှိ',
  },
};

function resolvePublicLanguage(acceptLanguage = '') {
  const value = String(acceptLanguage || '').toLowerCase();
  if (value.includes('my') || value.includes('my-mm') || value.includes('burmese')) return 'my';
  if (value.includes('en')) return 'en';
  return 'zh';
}

function translateEventDescription(eventCode, language, fallback) {
  return EVENT_DESCRIPTION_TRANSLATIONS[language]?.[eventCode]
    || EVENT_DESCRIPTION_TRANSLATIONS.zh[eventCode]
    || fallback
    || eventCode;
}

const PUBLIC_TRACKING_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PUBLIC_TRACKING_RATE_LIMIT_MAX = 10;
const publicTrackingRateBuckets = new Map();

function publicTrackingRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const bucket = publicTrackingRateBuckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    publicTrackingRateBuckets.set(ip, { count: 1, resetAt: now + PUBLIC_TRACKING_RATE_LIMIT_WINDOW_MS });
    res.setHeader('X-RateLimit-Limit', String(PUBLIC_TRACKING_RATE_LIMIT_MAX));
    res.setHeader('X-RateLimit-Remaining', String(PUBLIC_TRACKING_RATE_LIMIT_MAX - 1));
    return next();
  }

  if (bucket.count >= PUBLIC_TRACKING_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit', String(PUBLIC_TRACKING_RATE_LIMIT_MAX));
    res.setHeader('X-RateLimit-Remaining', '0');
    return res.status(429).json({
      success: false,
      error: 'Too Many Requests',
      message: '查询过于频繁，请稍后再试',
      retry_after_seconds: retryAfterSeconds,
    });
  }

  bucket.count += 1;
  publicTrackingRateBuckets.set(ip, bucket);
  res.setHeader('X-RateLimit-Limit', String(PUBLIC_TRACKING_RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, PUBLIC_TRACKING_RATE_LIMIT_MAX - bucket.count)));
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of publicTrackingRateBuckets.entries()) {
    if (bucket.resetAt <= now) publicTrackingRateBuckets.delete(ip);
  }
}, PUBLIC_TRACKING_RATE_LIMIT_WINDOW_MS).unref?.();
const CARRIER_ICONS = {
  YTO: null,
  JT: null,
  JNT: null,
  SF: null,
  ZTO: null,
  STO: null,
  YUNDA: null,
  UNKNOWN: null,
};

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addSeconds(value, seconds) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + seconds * 1000);
}

async function estimateDeliveryWindow(shipment, currentStatus, latestEvent) {
  if (currentStatus === 'DELIVERED') {
    const deliveredDate = toIsoDate(shipment.delivered_at || latestEvent?.event_time);
    return {
      estimated_delivery_date: deliveredDate,
      estimated_delivery_range_start: deliveredDate,
      estimated_delivery_range_end: deliveredDate,
      sample_size: deliveredDate ? 1 : 0,
    };
  }

  if (!latestEvent?.event_time || !currentStatus) {
    return {
      estimated_delivery_date: null,
      estimated_delivery_range_start: null,
      estimated_delivery_range_end: null,
      sample_size: 0,
    };
  }

  const history = await query(
    `
      WITH status_events AS (
        SELECT DISTINCT ON (s.id)
          s.id AS shipment_id,
          te.event_time AS status_time
        FROM shipments s
        JOIN tracking_events te ON te.shipment_id = s.id
        WHERE s.id <> $1
          AND s.origin_country = $2
          AND s.destination_country = $3
          AND COALESCE(s.carrier_code, '') = COALESCE($4, '')
          AND te.resulting_status = $5
          AND te.event_time IS NOT NULL
        ORDER BY s.id, te.event_time DESC, te.id DESC
      ), delivered_events AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          event_time AS delivered_time
        FROM tracking_events
        WHERE event_code = 'DELIVER'
          AND event_time IS NOT NULL
        ORDER BY shipment_id, event_time DESC, id DESC
      )
      SELECT
        COUNT(*)::int AS sample_size,
        AVG(EXTRACT(EPOCH FROM (d.delivered_time - se.status_time)))::float AS avg_seconds,
        STDDEV_POP(EXTRACT(EPOCH FROM (d.delivered_time - se.status_time)))::float AS stddev_seconds
      FROM status_events se
      JOIN delivered_events d ON d.shipment_id = se.shipment_id
      WHERE d.delivered_time >= se.status_time
    `,
    [
      shipment.id,
      shipment.origin_country,
      shipment.destination_country,
      shipment.carrier_code || null,
      currentStatus,
    ]
  );

  const row = history.rows[0] || {};
  const sampleSize = Number(row.sample_size || 0);
  const avgSeconds = Number(row.avg_seconds || 0);
  if (sampleSize < 3 || !avgSeconds || avgSeconds < 0) {
    return {
      estimated_delivery_date: null,
      estimated_delivery_range_start: null,
      estimated_delivery_range_end: null,
      sample_size: sampleSize,
    };
  }

  const baseTime = new Date(latestEvent.event_time);
  const stddevSeconds = Number(row.stddev_seconds || 0);
  const rangeSeconds = Math.max(stddevSeconds, 12 * 60 * 60);
  const estimatedDate = addSeconds(baseTime, avgSeconds);
  const rangeStart = addSeconds(baseTime, Math.max(0, avgSeconds - rangeSeconds));
  const rangeEnd = addSeconds(baseTime, avgSeconds + rangeSeconds);

  return {
    estimated_delivery_date: toIsoDate(estimatedDate),
    estimated_delivery_range_start: toIsoDate(rangeStart),
    estimated_delivery_range_end: toIsoDate(rangeEnd),
    sample_size: sampleSize,
  };
}
function toCarrier(shipment, trackingNo) {
  const detected = detectCarrier(trackingNo);
  const code = shipment.carrier_code || shipment.china_carrier_code || detected.carrier_code;
  const name = shipment.carrier_name || shipment.china_carrier_name || detected.carrier_name;
  return {
    code,
    name,
    icon: CARRIER_ICONS[code] || null,
  };
}

function toPublicEvent(event, language) {
  const eventCode = normalizeTrackingEventCode(event.event_code || event.event_type);
  const resultingStatus = event.resulting_status || statusFromEventCode(eventCode) || EVENT_CODE_TO_STATUS[eventCode] || null;
  return {
    id: event.id,
    event_code: eventCode,
    resulting_status: resultingStatus,
    event_description: translateEventDescription(eventCode, language, event.event_description || event.remark),
    event_city: event.event_city || event.location || null,
    event_time: event.event_time,
    source_type: event.source_type || event.source || null,
  };
}

function logConsistencyMismatch(payload) {
  console.warn(JSON.stringify({
    level: 'warn',
    service: 'HX MM',
    type: 'PUBLIC_TRACKING_CONSISTENCY_MISMATCH',
    ...payload,
    timestamp: new Date().toISOString(),
  }));
}

publicRouter.get('/public/tracking/:tracking_no', publicTrackingRateLimit, async (req, res, next) => {
  try {
    const trackingNo = normalizeTrackingNo(req.params.tracking_no);

    if (!trackingNo || !isValidTrackingFormat(trackingNo)) {
      return res.status(400).json({ success: false, error: '物流单号格式不正确' });
    }

    if (/^HX\d{8,}/i.test(trackingNo)) {
      return res.status(404).json({ success: false, error: '未查询到包裹' });
    }

    const shipmentResult = await query(
      `
        SELECT *
        FROM shipments
        WHERE tracking_no = $1
        LIMIT 1
      `,
      [trackingNo]
    );

    const shipment = shipmentResult.rows[0];
    if (!shipment) {
      return res.status(404).json({ success: false, error: '未查询到包裹' });
    }

    const language = resolvePublicLanguage(req.get('accept-language'));
    const timeline = (await listTrackingEvents(shipment.id)).map((event) => toPublicEvent(event, language));
    const latestEvent = timeline[0] || null;
    const currentStatus = shipment.current_status || shipment.status || latestEvent?.resulting_status || 'CREATED';
    const currentCity = latestEvent?.event_city || shipment.current_node || shipment.current_location || null;
    const carrier = toCarrier(shipment, trackingNo);
    const eta = await estimateDeliveryWindow(shipment, currentStatus, latestEvent);

    const response = {
      success: true,
      shipment: {
        tracking_no: shipment.tracking_no,
        current_status: currentStatus,
        current_city: currentCity,
        updated_at: latestEvent?.event_time || shipment.updated_at,
      },
      carrier,
      latest_event: latestEvent,
      timeline,
      current_city: currentCity,
      estimated_delivery: eta.estimated_delivery_date,
      estimated_delivery_date: eta.estimated_delivery_date,
      estimated_delivery_range_start: eta.estimated_delivery_range_start,
      estimated_delivery_range_end: eta.estimated_delivery_range_end,
    };

    if (latestEvent?.resulting_status && currentStatus !== latestEvent.resulting_status) {
      response._consistency_check = {
        ok: false,
        shipment_status: currentStatus,
        latest_event_resulting_status: latestEvent.resulting_status,
        latest_event_id: latestEvent.id,
      };
      logConsistencyMismatch({
        shipment_id: shipment.id,
        tracking_no: trackingNo,
        shipment_status: currentStatus,
        latest_event_resulting_status: latestEvent.resulting_status,
        latest_event_id: latestEvent.id,
      });
    }

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});




