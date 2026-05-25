import { useTranslation } from 'react-i18next';

export const STATUS_OPTIONS = ['CREATED', 'WAREHOUSE_RECEIVED', 'CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE', 'MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'];
export const STATUS_FLOW = ['CREATED', 'WAREHOUSE_RECEIVED', 'CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE', 'MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export const ERROR_KEYS = {
  'Missing API token': 'errors.missingToken',
  'Invalid username or password': 'errors.invalidLogin',
  'API token expired': 'errors.tokenExpired',
  'Too many login attempts. Please retry later.': 'errors.tooManyRequests',
  'Too many API requests. Please slow down.': 'errors.tooManyRequests',
  'Shipment not found': 'errors.shipmentNotFound',
  'Invalid scan action': 'errors.invalidScanAction',
};

export function formatTime(value, language = 'zh') {
  if (!value) return '-';
  const locales = { zh: 'zh-CN', en: 'en-US', my: 'my-MM' };
  return new Intl.DateTimeFormat(locales[language] || 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function statusClass(status = '') {
  return status.toLowerCase().replaceAll('_', '-');
}

export function apiTextError(t, message) {
  return ERROR_KEYS[message] ? t(ERROR_KEYS[message]) : message;
}

export function translateError(t, message, shipment, nextLabel = '') {
  if (message?.startsWith('Invalid status transition')) {
    return shipment
      ? t('errors.invalidTransitionWithNext', {
          status: t(`status.${shipment.current_status}`),
          next: nextLabel || t('scan.noNextAction'),
        })
      : t('errors.invalidTransition');
  }
  return apiTextError(t, message);
}

export function InfoItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Timeline({ events }) {
  const { t, i18n } = useTranslation();
  const ordered = [...(events || [])].sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

  return (
    <div className="timeline">
      <h2>{t('shipment.timeline')}</h2>
      {ordered.map((event, index) => (
        <div className={`timeline-item ${index === 0 ? 'current' : 'done'} ${(event.status || event.event_type || event.resulting_status) === 'EXCEPTION' ? 'exception' : ''}`} key={event.id}>
          <div className="dot" />
          <div>
            <div className="timeline-title">
              <strong>{t(`eventType.${event.event_code}`, { defaultValue: t(`status.${event.event_type}`) })}</strong>
              <span>{formatTime(event.event_time, i18n.language)}</span>
            </div>
            <p>{event.location || event.event_city}</p>
            {(event.remark || event.event_description) && <p className="muted">{event.remark || event.event_description}</p>}
            <small className="muted">{event.source || event.source_type}</small>
          </div>
        </div>
      ))}
    </div>
  );
}


