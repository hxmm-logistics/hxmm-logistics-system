import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, apiErrorMessage } from '../api';
import { formatTime, statusClass, STATUS_FLOW, STATUS_OPTIONS, translateError } from '../shared/ui.jsx';

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function isStale(shipment) {
  if (!shipment.updated_at || shipment.current_status === 'DELIVERED') return false;
  return Date.now() - new Date(shipment.updated_at).getTime() > 48 * 60 * 60 * 1000;
}

export function DashboardPage({ auth, refreshMe, navigate, active }) {
  const { t } = useTranslation();
  const [shipments, setShipments] = useState(() => JSON.parse(sessionStorage.getItem('hx_mm_dashboard_shipments') || '[]'));
  const [search, setSearch] = useState(() => sessionStorage.getItem('hx_mm_dashboard_search') || '');
  const [status, setStatus] = useState(() => sessionStorage.getItem('hx_mm_dashboard_status') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  async function loadShipments(nextSearch = search, nextStatus = status) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    sessionStorage.setItem('hx_mm_dashboard_search', nextSearch);
    sessionStorage.setItem('hx_mm_dashboard_status', nextStatus);
    setError('');
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/shipments', {
        params: { search: nextSearch, status: nextStatus },
      });
      if (requestId !== requestIdRef.current) return;
      setShipments(response.data);
      sessionStorage.setItem('hx_mm_dashboard_shipments', JSON.stringify(response.data));
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(translateError(t, apiErrorMessage(err)));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    refreshMe().catch(() => {});
    if (!shipments.length) loadShipments(search, status);
  }, [active]);

  function submitSearch(event) {
    event.preventDefault();
    loadShipments(search, status);
  }

  const stats = useMemo(() => ({
    today: shipments.filter((shipment) => isToday(shipment.created_at)).length,
    exception: shipments.filter((shipment) => shipment.current_status === 'EXCEPTION').length,
    border: shipments.filter((shipment) => shipment.current_status === 'AT_BORDER' || shipment.current_status === 'CUSTOMS_CLEARANCE').length,
    delivered: shipments.filter((shipment) => shipment.current_status === 'DELIVERED').length,
    stale: shipments.filter(isStale).length,
  }), [shipments]);

  return (
    <section className="dashboard-layout">
      <div className="dashboard-main">
        <div className="panel user-card">
          <div>
            <p className="muted">{t('dashboard.currentUser')}</p>
            <h1>{auth.user.display_name || auth.user.username}</h1>
            <span className="role-pill">{auth.user.role}</span>
          </div>
          <button onClick={() => navigate('/scan')}>{t('dashboard.goScan')}</button>
        </div>

        <div className="metric-grid">
          <MetricCard label={t('dashboard.todayNew')} value={stats.today} />
          <MetricCard label={t('dashboard.borderShipments')} value={stats.border} tone="border" />
          <MetricCard label={t('dashboard.exceptions')} value={stats.exception} tone="danger" />
          <MetricCard label={t('dashboard.delivered')} value={stats.delivered} tone="success" />
          <MetricCard label={t('dashboard.stale')} value={stats.stale} tone="warning" />
        </div>

        <form className="panel form-stack" onSubmit={submitSearch}>
          <label htmlFor="shipmentSearch">{t('dashboard.searchLabel')}</label>
          <div className="search-row">
            <input id="shipmentSearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('query.placeholder')} />
            <button type="submit" disabled={loading}>{loading ? t('query.searching') : t('query.search')}</button>
          </div>
          <select value={status} onChange={(e) => {
            setStatus(e.target.value);
            loadShipments(search, e.target.value);
          }}>
            <option value="">{t('admin.allStatuses')}</option>
            {STATUS_OPTIONS.map((item) => (
              <option value={item} key={item}>{t(`status.${item}`)}</option>
            ))}
          </select>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="panel">
          <div className="section-head">
            <h2>{t('dashboard.recentShipments')}</h2>
            <button className="ghost-button" onClick={() => loadShipments(search, status)}>{t('dashboard.refresh')}</button>
          </div>
          {loading ? <ListSkeleton /> : <ShipmentList shipments={shipments} navigate={navigate} />}
        </section>
      </div>

      <CreateShipmentCard onCreated={(shipment) => {
        setSearch(shipment.tracking_no);
        loadShipments(shipment.tracking_no, '');
        navigate(`/shipment/${shipment.tracking_no}`);
      }} />
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ShipmentList({ shipments, navigate }) {
  const { t, i18n } = useTranslation();

  if (!shipments.length) return <p className="muted empty-line">{t('dashboard.noShipments')}</p>;

  return (
    <div className="shipment-list">
      {shipments.map((shipment) => (
        <button className="shipment-row" key={shipment.id} onClick={() => navigate(`/shipment/${shipment.tracking_no}`)}>
          <span>
            <strong>{shipment.tracking_no}</strong>
            <small>{shipment.carrier_name || shipment.china_carrier_name || '-'} · HX {shipment.hx_no || shipment.platform_tracking_no}</small>
          </span>
          <span className={`status-pill ${statusClass(shipment.status || shipment.current_status)}`}>{t(`status.${shipment.status || shipment.current_status}`)}</span>
          <small>{formatTime(shipment.inbound_at || shipment.updated_at, i18n.language)}{isStale(shipment) ? ` · ${t('dashboard.staleShort')}` : ''}</small>
        </button>
      ))}
    </div>
  );
}

function CreateShipmentCard({ onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    china_carrier_code: 'YTO',
    china_carrier_name: '圆通速递',
    china_tracking_no: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const response = await apiClient.post('/shipment/create', form);
      setForm({ customer_name: '', customer_phone: '', china_carrier_code: 'YTO', china_carrier_name: '圆通速递', china_tracking_no: '' });
      setMessage(t('admin.created', { trackingNo: response.data.tracking_no }));
      onCreated(response.data);
    } catch (err) {
      setMessage(translateError(t, apiErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="panel form-stack create-card" onSubmit={submit}>
      <h2>{t('admin.createTitle')}</h2>
      <input value={form.customer_name} onChange={(e) => updateField('customer_name', e.target.value)} placeholder={t('admin.customerName')} required />
      <input value={form.customer_phone} onChange={(e) => updateField('customer_phone', e.target.value)} placeholder={t('admin.customerPhone')} required />
      <select value={form.china_carrier_code} onChange={(e) => {
        const carrierNames = { SF: '顺丰速运', ZTO: '中通快递', YTO: '圆通速递', YUNDA: '韵达快递', JT: '极兔速递' };
        updateField('china_carrier_code', e.target.value);
        updateField('china_carrier_name', carrierNames[e.target.value] || e.target.value);
      }}>
        <option value="SF">SF 顺丰</option>
        <option value="ZTO">ZTO 中通</option>
        <option value="YTO">YTO 圆通</option>
        <option value="YUNDA">YUNDA 韵达</option>
        <option value="JT">JT 极兔</option>
      </select>
      <input value={form.china_tracking_no} onChange={(e) => updateField('china_tracking_no', e.target.value)} placeholder={t('admin.chinaTrackingNo')} />
      <button type="submit" disabled={loading}>{loading ? t('admin.creating') : t('admin.create')}</button>
      {message && <p className="notice">{message}</p>}
    </form>
  );
}

export default function AdminOperationsPage({ auth, refreshMe, navigate }) {
  return (
    <div className="admin-module-stack">
      <section className="panel form-stack">
        <div className="section-head">
          <div>
            <p className="muted">KPI</p>
            <h2>运营仪表盘</h2>
          </div>
          <button type="button" onClick={() => navigate('/admin/dashboard')}>打开仪表盘</button>
        </div>
        <p className="muted">查看运单增长、状态分布、异常队列、批次和配送时效。</p>
      </section>
      <DashboardPage auth={auth} refreshMe={refreshMe} navigate={navigate} active />
      <section className="panel form-stack">
        <div className="section-head">
          <div>
            <p className="muted">Operations</p>
            <h2>异常管理</h2>
          </div>
          <button type="button" onClick={() => navigate('/admin/exceptions')}>打开异常管理</button>
        </div>
        <p className="muted">查看异常件、处理进度、上报破损/丢失/海关扣留等问题。</p>
      </section>

      <section className="admin-ops-layout">
        <OperatorCreateCard />
        <SystemStatusCard />
      </section>
    </div>
  );
}

function OperatorCreateCard() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await apiClient.post('/admin/operators/create', form);
      setMessage(t('admin.operatorCreated', { username: response.data.user.username }));
      setForm({ username: '', password: '', name: '', phone: '' });
    } catch (err) {
      setMessage(translateError(t, apiErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="panel form-stack" onSubmit={submit}>
      <h1>{t('admin.operatorManagement')}</h1>
      <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t('admin.operatorUsername')} autoComplete="off" required />
      <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t('admin.operatorPassword')} type="password" autoComplete="new-password" required />
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('admin.operatorName')} required />
      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t('admin.operatorPhone')} />
      <button type="submit" disabled={loading}>{loading ? t('admin.creating') : t('admin.createOperator')}</button>
      {message && <p className="notice">{message}</p>}
    </form>
  );
}

function SystemStatusCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const response = await apiClient.get('/health');
      setStatus(response.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="panel form-stack">
      <h1>{t('admin.systemStatus')}</h1>
      {status ? (
        <div className="status-health">
          <strong>{status.service}</strong>
          <span>{status.ok ? 'OK' : 'ERROR'} · DB {status.database}</span>
        </div>
      ) : <p className="muted">{t('app.loading')}</p>}
      {error && <p className="error">{error}</p>}
      <button className="ghost-button" onClick={load}>{t('dashboard.refresh')}</button>
    </div>
  );
}

export function ShipmentPage({ trackingNo }) {
  const { t } = useTranslation();
  const [shipment, setShipment] = useState(null);
  const [logs, setLogs] = useState(null);
  const [eventForm, setEventForm] = useState({ event_code: 'MYANMAR_ARRIVE', location: '曼德勒', remark: '' });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [shipmentResponse, logsResponse] = await Promise.all([
        apiClient.get(`/shipment/${trackingNo}`),
        apiClient.get(`/admin/shipments/${trackingNo}/logs`),
      ]);
      setShipment(shipmentResponse.data);
      setLogs(logsResponse.data);
    } catch (err) {
      setMessage(translateError(t, apiErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  }

  async function addEvent(event) {
    event.preventDefault();
    setMessage('');
    try {
      await apiClient.post('/tracking_events', { tracking_no: trackingNo, event_code: eventForm.event_code, event_city: eventForm.location, event_description: eventForm.remark, source_type: 'admin' });
      setMessage(t('admin.eventAdded'));
      load();
    } catch (err) {
      setMessage(translateError(t, apiErrorMessage(err)));
    }
  }

  useEffect(() => {
    load();
  }, [trackingNo]);

  if (loading) return <div className="panel"><ListSkeleton /></div>;

  return (
    <section className="detail-layout">
      <div className="detail-main">
        {shipment && <ShipmentDetail shipment={shipment} logs={logs} />}
      </div>
      <aside className="detail-side">
        <form className="panel form-stack" onSubmit={addEvent}>
          <h2>{t('admin.manualEventTitle')}</h2>
          <select value={eventForm.event_code} onChange={(e) => setEventForm({ ...eventForm, event_code: e.target.value })}>
            {STATUS_OPTIONS.map((status) => (
              <option value={status} key={status}>{t(`status.${status}`)}</option>
            ))}
          </select>
          <input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} placeholder={t('admin.location')} required />
          <textarea value={eventForm.remark} onChange={(e) => setEventForm({ ...eventForm, remark: e.target.value })} placeholder={t('admin.remark')} rows="3" />
          <button type="submit">{t('admin.addEvent')}</button>
        </form>
        {message && <p className={shipment ? 'notice' : 'error'}>{message}</p>}
      </aside>
    </section>
  );
}

function ShipmentDetail({ shipment, logs }) {
  const { t, i18n } = useTranslation();
  const events = shipment.events || [];
  const statusLogs = logs?.status_logs || [];

  return (
    <article className="shipment-card">
      <div className="status-head">
        <div>
          <p className="muted">{t('shipment.currentStatus')}</p>
          <h1>{t(`status.${shipment.current_status}`)}</h1>
        </div>
        <span className={`status-pill ${statusClass(shipment.current_status)}`}>{shipment.tracking_no}</span>
      </div>

      <dl className="info-grid">
        <InfoItem label={t('shipment.customer')} value={`${shipment.customer_name} · ${shipment.customer_phone}`} />
        <InfoItem label={t('shipment.currentLocation')} value={shipment.current_location} />
        <InfoItem label={t('shipment.chinaTrackingNo')} value={shipment.china_tracking_no || '-'} />
        <InfoItem label={t('shipment.chinaCarrier')} value={shipment.china_carrier_code ? `${shipment.china_carrier_code} ${shipment.china_carrier_name || ''}` : '-'} />
        <InfoItem label={t('shipment.updatedAt')} value={formatTime(shipment.updated_at, i18n.language)} />
        <InfoItem label={t('shipment.supportContact')} value={shipment.support_contact} />
      </dl>

      <StatusStepper currentStatus={shipment.current_status} />
      <Timeline events={events} />
      <StatusHistory logs={statusLogs} />
    </article>
  );
}

function StatusStepper({ currentStatus }) {
  const { t } = useTranslation();
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);
  const isException = currentStatus === 'EXCEPTION';

  return (
    <div className="status-stepper" aria-label={t('shipment.currentStage')}>
      {STATUS_FLOW.map((status, index) => {
        const done = !isException && currentIndex >= index;
        const active = currentStatus === status;
        return (
          <div className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`} key={status}>
            <span />
            <strong>{t(`status.${status}`)}</strong>
          </div>
        );
      })}
      {isException && <div className="step active exception-step"><span /><strong>{t('status.EXCEPTION')}</strong></div>}
    </div>
  );
}

function InfoItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Timeline({ events }) {
  const { t, i18n } = useTranslation();
  const ordered = useMemo(() => [...events].sort((a, b) => new Date(b.event_time) - new Date(a.event_time)), [events]);

  return (
    <div className="timeline">
      <h2>{t('shipment.timeline')}</h2>
      {ordered.map((event, index) => (
        <div className={`timeline-item ${index === 0 ? 'current' : 'done'} ${(event.status || event.event_type || event.resulting_status) === 'EXCEPTION' ? 'exception' : ''}`} key={event.id}>
          <div className="dot" />
          <div>
            <div className="timeline-title">
              <strong>{t(`status.${event.event_type}`)}</strong>
              <span>{formatTime(event.event_time, i18n.language)}</span>
            </div>
            <p>{event.location}</p>
            {event.remark && <p className="muted">{event.remark}</p>}
            <small className="muted">{event.source}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusHistory({ logs }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="history">
      <h2>{t('shipment.statusHistory')}</h2>
      {!logs.length && <p className="muted">{t('shipment.noStatusLogs')}</p>}
      {logs.map((log) => (
        <div className="history-row" key={log.id}>
          <span>{t(`status.${log.from_status}`)} {'->'} {t(`status.${log.to_status}`)}</span>
          <small>{log.location} · {log.display_name || log.username || t('app.system')}</small>
          <small>{formatTime(log.created_at, i18n.language)}</small>
        </div>
      ))}
    </div>
  );
}







