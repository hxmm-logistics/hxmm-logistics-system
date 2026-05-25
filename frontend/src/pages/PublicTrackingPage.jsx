import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, apiErrorMessage } from '../api';
import { formatTime, InfoItem, statusClass, translateError } from '../shared/ui.jsx';

const PUBLIC_PROGRESS_FLOW = ['WAREHOUSE_RECEIVED', 'CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS_CLEARANCE', 'MYANMAR_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function carrierInitial(name = '') {
  return (name || 'HX').trim().slice(0, 1).toUpperCase();
}

function publicEventStatus(event) {
  return event.status || event.resulting_status || event.event_type || 'CREATED';
}

function publicTimelineLocation(event) {
  return event.event_city || event.location || '-';
}

function publicTimelineDescription(event) {
  return event.event_description || event.remark || event.event_code || event.event_type || '-';
}

export default function PublicTrackingPage() {
  const { t, i18n } = useTranslation();
  const inputRef = useRef(null);
  const retryRef = useRef('');
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const [trackingNo, setTrackingNo] = useState('');
  const [detectedCarrier, setDetectedCarrier] = useState(null);
  const [shipment, setShipment] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const normalized = trackingNo.trim().toUpperCase();
      if (normalized.startsWith('YT')) setDetectedCarrier('YTO');
      else if (normalized.startsWith('JT')) setDetectedCarrier('J&T');
      else if (normalized.startsWith('SF')) setDetectedCarrier('SF Express');
      else if (normalized.startsWith('ZTO')) setDetectedCarrier('ZTO');
      else if (normalized.startsWith('STO')) setDetectedCarrier('STO');
      else if (normalized.startsWith('YD') || normalized.startsWith('YUNDA')) setDetectedCarrier('Yunda');
      else setDetectedCarrier(normalized ? t('query.unknownCarrier') : null);
    }, 180);
    return () => window.clearTimeout(debounceRef.current);
  }, [trackingNo, t]);

  async function runQuery(value) {
    const nextTrackingNo = String(value || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!nextTrackingNo) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    retryRef.current = nextTrackingNo;
    setMessage('');
    setShipment(null);
    setLoading(true);
    try {
      const response = await apiClient.get(`/public/tracking/${encodeURIComponent(nextTrackingNo)}`);
      if (requestId !== requestIdRef.current) return;
      const payload = response.data;
      setShipment({
        ...payload.shipment,
        carrier: payload.carrier,
        latest_event: payload.latest_event,
        timeline: payload.timeline || [],
        current_city: payload.current_city,
        estimated_delivery: payload.estimated_delivery_date || payload.estimated_delivery,
        estimated_delivery_date: payload.estimated_delivery_date || null,
        estimated_delivery_range_start: payload.estimated_delivery_range_start || null,
        estimated_delivery_range_end: payload.estimated_delivery_range_end || null,
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const status = err.response?.status;
      if (status === 404) setMessage(t('query.notFound'));
      else if (status === 400) setMessage(t('query.invalidTrackingNo', { defaultValue: '物流单号格式不正确，请检查后重试' }));
      else if (!err.response) setMessage(t('query.networkError', { defaultValue: '网络连接异常，请稍后重试' }));
      else setMessage(translateError(t, apiErrorMessage(err)));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    runQuery(trackingNo);
  }

  const timeline = shipment?.timeline || [];
  const currentStatus = shipment?.current_status || shipment?.status;

  return (
    <section className="public-tracking-screen">
      <form className="tracking-search-panel" onSubmit={submit} noValidate>
        <div className="tracking-search-copy">
          <p className="eyebrow">HX MM</p>
          <h1>{t('query.publicTitle')}</h1>
          <p>{t('query.publicSubtitle')}</p>
        </div>
        <label htmlFor="publicTrackingNo">{t('query.label')}</label>
        <div className="tracking-search-box">
          <input
            ref={inputRef}
            id="publicTrackingNo"
            value={trackingNo}
            onChange={(e) => setTrackingNo(e.target.value)}
            placeholder={t('query.placeholder')}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button type="submit" disabled={loading || !trackingNo.trim()}>{loading ? t('query.searching') : t('query.search')}</button>
        </div>
        <div className="tracking-hints">
          <span>{t('query.supportedCarriers')}</span>
          {detectedCarrier && <strong>{t('query.detectedCarrier', { carrier: detectedCarrier })}</strong>}
        </div>
      </form>

      {loading && <TrackingSkeleton />}

      {message && !loading && (
        <div className="tracking-empty-state">
          <strong>{message}</strong>
          <p>{t('query.emptyHint')}</p>
          <button type="button" className="ghost-button" onClick={() => runQuery(retryRef.current || trackingNo)}>{t('app.retry')}</button>
        </div>
      )}

      {shipment && !loading && (
        <article className="tracking-result-shell">
          <section className="tracking-summary-card">
            <CarrierMark carrier={shipment.carrier} fallback={shipment.carrier_name} />
            <div className="tracking-summary-main">
              <span>{shipment.carrier?.name || shipment.carrier_name || t('query.unknownCarrier')} · {shipment.carrier?.code || shipment.carrier_code || 'UNKNOWN'}</span>
              <h2>{t(`status.${currentStatus}`)}</h2>
              <p>{shipment.latest_event?.event_description || t('query.noUpdatesYet')}</p>
            </div>
            <span className={`status-pill ${statusClass(currentStatus)}`}>{t(`status.${currentStatus}`)}</span>
          </section>

          <section className="tracking-progress-card">
            <div className="tracking-no-line">
              <span>{t('query.resultTrackingNo')}</span>
              <strong>{shipment.tracking_no}</strong>
            </div>
            <PublicProgress currentStatus={currentStatus} />
            <dl className="tracking-consumer-grid">
              <InfoItem label={t('query.currentCity')} value={shipment.current_city || shipment.current_node || '-'} />
              <InfoItem label={t('query.latestUpdate')} value={formatTime(shipment.updated_at, i18n.language)} />
              <InfoItem label={t('query.estimatedDelivery')} value={shipment.estimated_delivery || '-'} />
              <InfoItem label={t('query.currentNode')} value={shipment.latest_event?.event_description || shipment.current_node || '-'} />
            </dl>
          </section>

          <PublicTrackingTimeline events={timeline} estimatedDate={shipment.estimated_delivery_date} language={i18n.language} />
        </article>
      )}
    </section>
  );
}

function CarrierMark({ carrier, fallback }) {
  const label = carrier?.name || fallback || 'HX';
  if (carrier?.icon) {
    return <img className="carrier-mark carrier-mark-image" src={carrier.icon} alt={label} />;
  }
  return <div className="carrier-mark" aria-hidden="true">{carrierInitial(label)}</div>;
}
function TrackingSkeleton() {
  return (
    <div className="tracking-skeleton" aria-label="loading">
      <span />
      <span />
      <span />
    </div>
  );
}

function PublicProgress({ currentStatus }) {
  const { t } = useTranslation();
  const currentIndex = PUBLIC_PROGRESS_FLOW.indexOf(currentStatus);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return (
    <div className="public-progress" aria-label={t('shipment.currentStage')}>
      {PUBLIC_PROGRESS_FLOW.map((status, index) => (
        <div className={`public-progress-step ${index <= safeIndex ? 'done' : ''} ${status === currentStatus ? 'active' : ''}`} key={status}>
          <span />
          <small>{t(`status.${status}`)}</small>
        </div>
      ))}
    </div>
  );
}

function formatEstimatedDate(value, language) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : language, { month: 'long', day: 'numeric' }).format(date);
}

function PublicTrackingTimeline({ events, estimatedDate, language }) {
  const { t, i18n } = useTranslation();
  const ordered = useMemo(() => [...events].sort((a, b) => new Date(b.event_time) - new Date(a.event_time)), [events]);
  return (
    <section className="consumer-timeline">
      <h2>{t('shipment.timeline')}</h2>
      {estimatedDate && <div className="timeline-eta">预计送达：{formatEstimatedDate(estimatedDate, language)}</div>}
      {!ordered.length && <div className="tracking-empty-state compact"><strong>{t('query.waitingInbound')}</strong><p>{t('query.noUpdatesYet')}</p></div>}
      {ordered.map((event, index) => {
        const status = publicEventStatus(event);
        return (
          <div className={`consumer-timeline-item ${index === 0 ? 'current' : ''} ${statusClass(status)}`} key={event.id || `${event.event_time}-${index}`}>
            <div className="consumer-time">
              <strong>{formatTime(event.event_time, i18n.language)}</strong>
            </div>
            <div className="consumer-node-icon" aria-hidden="true" />
            <div className="consumer-event-card">
              <strong>{publicTimelineDescription(event)}</strong>
              <span>{publicTimelineLocation(event)}</span>
              <small>{t(`eventType.${event.event_type}`, { defaultValue: t(`status.${status}`, { defaultValue: event.event_type }) })}</small>
            </div>
          </div>
        );
      })}
    </section>
  );
}





