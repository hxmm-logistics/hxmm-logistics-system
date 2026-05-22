import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import './i18n';
import './styles.css';
import { apiClient, apiErrorMessage, clearAuth, getStoredAuth, saveAuth } from './api';

const STATUS_OPTIONS = ['PENDING', 'IN_CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS', 'IN_MYANMAR', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'];
const SCAN_ACTIONS = [
  { type: 'event', event_type: 'AT_BORDER', location: '瑞丽 / 木姐边境', remark: '包裹已到达边境', labelKey: 'scan.arrivedBorder' },
  { type: 'scan', action: 'arrived_muse', status: 'IN_MYANMAR', location: '木姐', labelKey: 'scan.arrivedMuse' },
  { type: 'scan', action: 'arrived_mandalay', status: 'IN_MYANMAR', location: '曼德勒', labelKey: 'scan.arrivedMandalay' },
  { type: 'scan', action: 'out_for_delivery', status: 'OUT_FOR_DELIVERY', location: '派送中', labelKey: 'scan.outForDelivery' },
  { type: 'scan', action: 'delivered', status: 'DELIVERED', location: '客户已签收', labelKey: 'scan.delivered' },
];
const STATUS_FLOW = ['PENDING', 'IN_CHINA_TRANSIT', 'AT_BORDER', 'IN_MYANMAR', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const ADMIN_ROUTES = ['/dashboard', '/admin'];
const NEXT_ACTION_BY_STATUS = {
  IN_CHINA_TRANSIT: 'AT_BORDER',
  AT_BORDER: 'arrived_muse',
  CUSTOMS: 'arrived_muse',
  IN_MYANMAR: 'out_for_delivery',
  OUT_FOR_DELIVERY: 'delivered',
};

const ERROR_KEYS = {
  'Missing API token': 'errors.missingToken',
  'Invalid username or password': 'errors.invalidLogin',
  'API token expired': 'errors.tokenExpired',
  'Too many login attempts. Please retry later.': 'errors.tooManyRequests',
  'Too many API requests. Please slow down.': 'errors.tooManyRequests',
  'Shipment not found': 'errors.shipmentNotFound',
  'Invalid scan action': 'errors.invalidScanAction',
};

function translateError(t, message, shipment) {
  if (message?.startsWith('Invalid status transition')) {
    return shipment
      ? t('errors.invalidTransitionWithNext', {
        status: t(`status.${shipment.current_status}`),
        next: getNextActionLabel(t, shipment.current_status),
      })
      : t('errors.invalidTransition');
  }
  return ERROR_KEYS[message] ? t(ERROR_KEYS[message]) : message;
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  function navigate(to) {
    window.history.pushState({}, '', to);
    setPath(to);
  }

  return { path, navigate };
}

function formatTime(value, language = 'zh') {
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

function statusClass(status = '') {
  return status.toLowerCase().replaceAll('_', '-');
}

function getActionKey(action) {
  return action ? (action.action || action.event_type) : '';
}

function getNextAction(status) {
  return SCAN_ACTIONS.find((item) => getActionKey(item) === NEXT_ACTION_BY_STATUS[status]) || null;
}

function getNextActionLabel(t, status) {
  const action = getNextAction(status);
  return action ? t(action.labelKey) : t('scan.noNextAction');
}

function isActionAllowed(action, status) {
  if (!action || !status) return false;
  return getActionKey(action) === NEXT_ACTION_BY_STATUS[status];
}

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

function App() {
  const { t, i18n } = useTranslation();
  const { path, navigate } = useRoute();
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const role = auth?.user?.role?.trim().toLowerCase();
  const isAdmin = role === 'admin';
  const isOperator = role === 'operator';

  useEffect(() => {
    if (!auth && path !== '/login') navigate('/login');
    if (auth && (path === '/' || path === '/login')) navigate(isOperator ? '/scan' : '/dashboard');
    if (isOperator && ADMIN_ROUTES.some((route) => path.startsWith(route))) navigate('/scan');
  }, [auth, isOperator, path]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  async function refreshMe() {
    const response = await apiClient.get('/auth/me');
    setAuth((current) => current ? { ...current, user: response.data.user } : current);
  }

  function handleLogin(nextAuth) {
    saveAuth(nextAuth);
    setAuth(nextAuth);
    navigate(nextAuth.user.role?.trim().toLowerCase() === 'operator' ? '/scan' : '/dashboard');
  }

  function logout() {
    clearAuth();
    setAuth(null);
    navigate('/login');
  }

  function changeLanguage(event) {
    i18n.changeLanguage(event.target.value);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => navigate(auth ? (isOperator ? '/scan' : '/dashboard') : '/login')}>
          <span className="eyebrow">{t('app.subtitle')}</span>
          <strong>HX MM</strong>
        </button>
        <div className="topbar-actions">
          <label className="language-switch" htmlFor="language">
            <span>{t('language.label')}</span>
            <select id="language" value={i18n.language} onChange={changeLanguage}>
              <option value="zh">{t('language.zh')}</option>
              <option value="en">{t('language.en')}</option>
              <option value="my">{t('language.my')}</option>
            </select>
          </label>
          {auth && <button className="logout-button" onClick={logout}>{t('app.logout')}</button>}
        </div>
      </header>

      {auth && (
        <nav className="tabs" aria-label={t('app.navLabel')}>
          {isAdmin && <button className={path === '/dashboard' ? 'active' : ''} onClick={() => navigate('/dashboard')}>{t('app.dashboard')}</button>}
          <button className={path === '/scan' ? 'active' : ''} onClick={() => navigate('/scan')}>{t('app.scan')}</button>
          {isAdmin && <button className={path === '/admin' ? 'active' : ''} onClick={() => navigate('/admin')}>{t('app.admin')}</button>}
        </nav>
      )}

      {!isOnline && <div className="network-banner">{t('app.offline')}</div>}

      {path === '/login' && <LoginPage onLogin={handleLogin} />}
      {isAdmin && <div hidden={path !== '/dashboard'}><DashboardPage auth={auth} refreshMe={refreshMe} navigate={navigate} active={path === '/dashboard'} /></div>}
      {auth && path === '/scan' && <ScanPage navigate={navigate} active={path === '/scan'} role={auth.user.role} />}
      {isAdmin && <div hidden={path !== '/admin'}><AdminOperationsPage /></div>}
      {auth && path.startsWith('/shipment/') && <ShipmentPage trackingNo={decodeURIComponent(path.replace('/shipment/', ''))} />}
    </main>
  );
}

function LoginPage({ onLogin }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ username: 'admin', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const authError = sessionStorage.getItem('hx_mm_auth_error');
    if (authError === 'TOKEN_EXPIRED') {
      setError(t('errors.tokenExpired'));
    }
    sessionStorage.removeItem('hx_mm_auth_error');
  }, [t]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await apiClient.post('/auth/login', form);
      onLogin(response.data);
    } catch (err) {
      setError(translateError(t, apiErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <form className="panel form-stack login-panel" onSubmit={submit}>
        <h1>{t('auth.loginTitle')}</h1>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t('auth.username')} autoComplete="username" required />
        <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t('auth.password')} type="password" autoComplete="current-password" required />
        <button type="submit" disabled={loading}>{loading ? t('auth.loggingIn') : t('auth.login')}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}

function DashboardPage({ auth, refreshMe, navigate, active }) {
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
    border: shipments.filter((shipment) => shipment.current_status === 'AT_BORDER' || shipment.current_status === 'CUSTOMS').length,
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
            <small>{shipment.customer_name} · {shipment.customer_phone}</small>
          </span>
          <span className={`status-pill ${statusClass(shipment.current_status)}`}>{t(`status.${shipment.current_status}`)}</span>
          <small>{formatTime(shipment.updated_at, i18n.language)}{isStale(shipment) ? ` · ${t('dashboard.staleShort')}` : ''}</small>
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

function AdminOperationsPage() {
  const { t } = useTranslation();
  return (
    <section className="admin-ops-layout">
      <OperatorCreateCard />
      <SystemStatusCard />
    </section>
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

function ShipmentPage({ trackingNo }) {
  const { t } = useTranslation();
  const [shipment, setShipment] = useState(null);
  const [logs, setLogs] = useState(null);
  const [eventForm, setEventForm] = useState({ event_type: 'IN_MYANMAR', location: '曼德勒', remark: '' });
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
      await apiClient.post(`/shipment/${trackingNo}/event`, { ...eventForm, source: 'manual' });
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
          <select value={eventForm.event_type} onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}>
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
        <div className={`timeline-item ${index === 0 ? 'current' : 'done'} ${event.event_type === 'EXCEPTION' ? 'exception' : ''}`} key={event.id}>
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

function ScanPage({ navigate, active }) {
  const { t } = useTranslation();
  const [trackingNo, setTrackingNo] = useState('');
  const [action, setAction] = useState('AT_BORDER');
  const [shipment, setShipment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [lastError, setLastError] = useState('');
  const [scannerRunning, setScannerRunning] = useState(false);
  const [cameraMode, setCameraMode] = useState('idle');
  const [continuousScan, setContinuousScan] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [recentScans, setRecentScans] = useState(() => JSON.parse(localStorage.getItem('hx_mm_recent_scans') || '[]'));
  const [failedQueue, setFailedQueue] = useState(() => JSON.parse(localStorage.getItem('hx_mm_scan_queue') || '[]'));
  const scannerRef = useRef(null);
  const scannerModuleRef = useRef(null);
  const scannerRunningRef = useRef(false);
  const startingScannerRef = useRef(false);
  const shouldRestartCameraRef = useRef(false);
  const activeRef = useRef(active);
  const continuousScanRef = useRef(continuousScan);
  const lastDecodedRef = useRef({ value: '', time: 0 });
  const trackingInputRef = useRef(null);
  const lastSubmitRef = useRef({ trackingNo: '', action: '', time: 0 });
  const isWebKitMobile = /iP(hone|ad|od)|AppleWebKit/i.test(navigator.userAgent) && /Mobile|CriOS|FxiOS|Telegram/i.test(navigator.userAgent);

  useEffect(() => {
    activeRef.current = active;
    if (active) window.setTimeout(() => trackingInputRef.current?.focus(), 80);
  }, [active]);

  useEffect(() => {
    continuousScanRef.current = continuousScan;
  }, [continuousScan]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (shipment?.current_status) {
      const next = getNextAction(shipment.current_status);
      if (next) setAction(getActionKey(next));
    }
  }, [shipment?.current_status]);

  useEffect(() => {
    localStorage.setItem('hx_mm_recent_scans', JSON.stringify(recentScans.slice(0, 20)));
  }, [recentScans]);

  useEffect(() => {
    localStorage.setItem('hx_mm_scan_queue', JSON.stringify(failedQueue.slice(0, 50)));
  }, [failedQueue]);

  const stopScanner = useCallback(async (nextMode = 'idle') => {
    const scanner = scannerRef.current;
    scannerRunningRef.current = false;
    setScannerRunning(false);
    setTorchOn(false);
    setTorchSupported(false);
    try {
      await scanner?.stop?.();
    } catch {
      // Safari may already have stopped the stream during pagehide.
    }
    try {
      await scanner?.clear?.();
    } catch {
      // The scanner DOM can be gone after route changes.
    }
    const video = document.querySelector('#qr-reader video');
    const stream = video?.srcObject;
    stream?.getTracks?.().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    scannerRef.current = null;
    setCameraMode(nextMode);
  }, []);

  useEffect(() => {
    if (!active) stopScanner();
  }, [active, stopScanner]);

  const startScanner = useCallback(async () => {
    setMessage('');
    if (startingScannerRef.current || scannerRunningRef.current) return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setMessage(t('scan.httpsRequired'));
      setCameraMode('error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(t('scan.cameraUnavailable'));
      setCameraMode('error');
      return;
    }

    try {
      startingScannerRef.current = true;
      await stopScanner();
      setCameraMode('starting');
      setMessage(t('scan.loadingCamera'));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      scannerModuleRef.current ||= await import('html5-qrcode');
      const { Html5Qrcode } = scannerModuleRef.current;
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: isWebKitMobile ? 5 : 8, qrbox: { width: isWebKitMobile ? 220 : 240, height: isWebKitMobile ? 220 : 240 } },
        async (decodedText) => {
          const value = decodedText.trim();
          const now = Date.now();
          if (lastDecodedRef.current.value === value && now - lastDecodedRef.current.time < 1200) return;
          lastDecodedRef.current = { value, time: now };
          setTrackingNo(value);
          setShipment(null);
          setToast(t('scan.recognized'));
          navigator.vibrate?.(80);
          trackingInputRef.current?.focus();
          loadShipment(value);
          if (!continuousScanRef.current) await stopScanner();
        }
      );
      scannerRunningRef.current = true;
      setScannerRunning(true);
      setCameraMode('running');
      setMessage('');
      const video = document.querySelector('#qr-reader video');
      video?.setAttribute('playsinline', 'true');
      video?.setAttribute('webkit-playsinline', 'true');
      const track = video?.srcObject?.getVideoTracks?.()[0];
      setTorchSupported(Boolean(track?.getCapabilities?.().torch));
    } catch {
      await stopScanner('error');
      setMessage(isWebKitMobile ? t('scan.safariCameraHint') : t('scan.cameraUnavailable'));
    } finally {
      startingScannerRef.current = false;
    }
  }, [isWebKitMobile, stopScanner, t]);

  async function toggleTorch() {
    const video = document.querySelector('#qr-reader video');
    const track = video?.srcObject?.getVideoTracks?.()[0];
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch {
      setMessage(t('scan.torchUnavailable'));
    }
  }

  useEffect(() => {
    const suspendCamera = () => {
      shouldRestartCameraRef.current = scannerRunningRef.current;
      stopScanner();
    };
    const resumeCamera = () => {
      if (!activeRef.current || !shouldRestartCameraRef.current) return;
      shouldRestartCameraRef.current = false;
      window.setTimeout(() => {
        if (activeRef.current) startScanner();
      }, 250);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') suspendCamera();
      if (document.visibilityState === 'visible') resumeCamera();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', suspendCamera);
    window.addEventListener('pageshow', resumeCamera);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', suspendCamera);
      window.removeEventListener('pageshow', resumeCamera);
      stopScanner();
    };
  }, [startScanner, stopScanner]);

  async function submit(event) {
    event.preventDefault();
    await submitScan({ trackingNo: trackingNo.trim(), actionKey: nextAction ? getActionKey(nextAction) : action, enqueueOnFailure: true });
  }

  async function submitScan({ trackingNo: targetTrackingNo, actionKey, enqueueOnFailure }) {
    setMessage('');
    setLastError('');
    const normalizedTrackingNo = targetTrackingNo;
    const now = Date.now();
    if (
      lastSubmitRef.current.trackingNo === normalizedTrackingNo &&
      lastSubmitRef.current.action === actionKey &&
      now - lastSubmitRef.current.time < 1800
    ) {
      setToast(t('scan.duplicateBlocked'));
      return false;
    }
    setLoading(true);
    try {
      lastSubmitRef.current = { trackingNo: normalizedTrackingNo, action: actionKey, time: now };
      const selectedAction = SCAN_ACTIONS.find((item) => getActionKey(item) === actionKey);
      if (!selectedAction) {
      setMessage(t('errors.invalidScanAction'));
        return false;
      }
      if (shipment?.current_status && !isActionAllowed(selectedAction, shipment.current_status)) {
        setMessage(t('errors.invalidTransitionWithNext', {
          status: t(`status.${shipment.current_status}`),
          next: getNextActionLabel(t, shipment.current_status),
        }));
        return false;
      }
      const response = selectedAction.type === 'event'
        ? await apiClient.post(`/shipment/${normalizedTrackingNo}/event`, {
          event_type: selectedAction.event_type,
          location: selectedAction.location,
          remark: selectedAction.remark,
          source: 'manual',
        })
        : await apiClient.post(`/shipment/${normalizedTrackingNo}/scan-update`, { action: selectedAction.action });
      setShipment(response.data);
      setTrackingNo('');
      setRecentScans((items) => [{
        tracking_no: response.data.tracking_no,
        status: response.data.current_status,
        location: response.data.current_location,
        time: new Date().toISOString(),
      }, ...items.filter((item) => item.tracking_no !== response.data.tracking_no)].slice(0, 20));
      setToast(t('scan.updatedWithStatus', { status: t(`status.${response.data.current_status}`), location: response.data.current_location }));
      navigator.vibrate?.([80, 40, 80]);
      return true;
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err), shipment);
      setMessage(text);
      setLastError(text);
      if (enqueueOnFailure && (!navigator.onLine || err.code === 'ECONNABORTED' || err.message === 'Network Error')) {
        setFailedQueue((items) => [{
          trackingNo: normalizedTrackingNo,
          action: actionKey,
          createdAt: new Date().toISOString(),
        }, ...items].slice(0, 50));
        setToast(t('scan.queued'));
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function checkShipment() {
    await loadShipment(trackingNo.trim());
  }

  async function loadShipment(targetTrackingNo) {
    if (!targetTrackingNo) return;
    setMessage('');
    setLastError('');
    setLoading(true);
    try {
      const response = await apiClient.get(`/shipment/${targetTrackingNo}`);
      setShipment(response.data);
      setToast(t('scan.loadedCurrent', { status: t(`status.${response.data.current_status}`) }));
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err));
      setMessage(text);
      setLastError(text);
    } finally {
      setLoading(false);
    }
  }

  async function retryLast() {
    if (!trackingNo.trim()) return;
    if (lastError) {
      await checkShipment();
    }
  }

  async function retryQueueItem(item) {
    const ok = await submitScan({ trackingNo: item.trackingNo, actionKey: item.action, enqueueOnFailure: false });
    if (ok) setFailedQueue((items) => items.filter((queued) => queued.createdAt !== item.createdAt));
  }

  const nextAction = shipment?.current_status ? getNextAction(shipment.current_status) : null;
  const selectedAction = nextAction || SCAN_ACTIONS.find((item) => getActionKey(item) === action);
  const actionAllowed = shipment?.current_status ? Boolean(nextAction) : true;
  const canSubmitNextAction = Boolean(trackingNo.trim() && shipment && nextAction && isActionAllowed(nextAction, shipment.current_status));

  return (
    <section className="scan-layout">
      {toast && <div className="toast">{toast}</div>}
      <form className="panel form-stack" onSubmit={submit}>
        <h1>{t('scan.title')}</h1>
        <p className="muted compact-help">{t('scan.mobileHelp')}</p>
        {shipment && (
          <div className="current-scan-status">
            <span>{t('shipment.currentStatus')}</span>
            <strong>{t(`status.${shipment.current_status}`)}</strong>
            <small>{t('scan.nextRecommended')}: {getNextActionLabel(t, shipment.current_status)}</small>
          </div>
        )}
        <label htmlFor="scanTrackingNo">{t('scan.manualInput')}</label>
        <div className="scan-input-row">
          <input ref={trackingInputRef} id="scanTrackingNo" value={trackingNo} onChange={(e) => {
            setTrackingNo(e.target.value);
            setShipment(null);
            setMessage('');
          }} placeholder={t('query.placeholder')} inputMode="text" autoCapitalize="characters" required />
          <button type="button" className="camera-button" onClick={scannerRunning ? () => stopScanner() : startScanner} disabled={cameraMode === 'starting'} aria-label={scannerRunning ? t('scan.stopCamera') : t('scan.startCamera')}>
            <span aria-hidden="true">📷</span>
            <small>{cameraMode === 'starting' ? t('scan.openingCamera') : scannerRunning ? t('scan.stopCameraShort') : t('scan.camera')}</small>
          </button>
        </div>
        {(cameraMode === 'starting' || cameraMode === 'running') && (
          <div className={`scanner-box ${cameraMode}`}>
            {cameraMode === 'starting' && <div className="camera-placeholder">{t('scan.loadingCamera')}</div>}
            <div id="qr-reader" />
          </div>
        )}
        {cameraMode === 'error' && (
          <div className="camera-fallback">
            <strong>{t('scan.cameraFailedTitle')}</strong>
            <span>{isWebKitMobile ? t('scan.safariCameraHint') : t('scan.cameraUnavailable')}</span>
            <button type="button" className="ghost-button" onClick={startScanner}>{t('scan.cameraRetry')}</button>
          </div>
        )}
        {cameraMode === 'running' && (
          <div className="button-row camera-controls">
            <button type="button" className="ghost-button" onClick={toggleTorch} disabled={!torchSupported}>{torchOn ? t('scan.torchOff') : t('scan.torchOn')}</button>
            <label className="toggle-row">
              <input type="checkbox" checked={continuousScan} onChange={(e) => setContinuousScan(e.target.checked)} />
              <span>{t('scan.continuous')}</span>
            </label>
          </div>
        )}
        <p className="muted compact-help">{t('scan.permissionHint')}</p>
        <button type="button" className="ghost-button" onClick={checkShipment} disabled={loading || !trackingNo.trim()}>{t('scan.checkCurrent')}</button>
        {shipment ? (
          nextAction ? (
            <div className="next-action-card">
              <span>{t('scan.onlyNextAction')}</span>
              <strong>{t(nextAction.labelKey)}</strong>
              <small>{nextAction.location}</small>
            </div>
          ) : (
            <div className="next-action-card done">
              <strong>{t('scan.noNextAction')}</strong>
            </div>
          )
        ) : (
          <div className="next-action-card pending">
            <strong>{t('scan.checkFirst')}</strong>
            <small>{t('scan.manualFallback')}</small>
          </div>
        )}
        {!actionAllowed && shipment && <p className="warning">{t('errors.invalidTransitionWithNext', { status: t(`status.${shipment.current_status}`), next: getNextActionLabel(t, shipment.current_status) })}</p>}
        <button className="primary-scan-button" type="submit" disabled={loading || !canSubmitNextAction}>{loading ? t('scan.updating') : nextAction ? t('scan.submitNext', { action: t(nextAction.labelKey) }) : t('scan.submit')}</button>
        {message && <p className={shipment ? 'notice' : 'error'}>{message}</p>}
        {lastError && <button type="button" className="ghost-button" onClick={retryLast}>{t('app.retry')}</button>}
      </form>

      <div>
        {shipment ? (
          <div className="panel scan-result">
            <p className="muted">{t('scan.latestStatus')}</p>
            <h2>{t(`status.${shipment.current_status}`)}</h2>
            <p>{shipment.current_location}</p>
            <button onClick={() => navigate(`/shipment/${shipment.tracking_no}`)}>{t('scan.viewDetail')}</button>
          </div>
        ) : (
          <div className="empty">{t('scan.waiting')}</div>
        )}
        <ScanQueue queue={failedQueue} onRetry={retryQueueItem} />
        <RecentScanList scans={recentScans} navigate={navigate} />
      </div>
    </section>
  );
}

function ScanQueue({ queue, onRetry }) {
  const { t } = useTranslation();
  if (!queue.length) return null;
  return (
    <div className="panel scan-side-list">
      <h2>{t('scan.failedQueue')}</h2>
      {queue.map((item) => (
        <button className="list-item" key={item.createdAt} onClick={() => onRetry(item)}>
          <span>{item.trackingNo}</span>
          <small>{t('app.retry')} · {item.action}</small>
        </button>
      ))}
    </div>
  );
}

function RecentScanList({ scans, navigate }) {
  const { t, i18n } = useTranslation();
  if (!scans.length) return null;
  return (
    <div className="panel scan-side-list">
      <h2>{t('scan.recentScans')}</h2>
      {scans.map((item) => (
        <button className="list-item" key={`${item.tracking_no}-${item.time}`} onClick={() => navigate(`/shipment/${item.tracking_no}`)}>
          <span>{item.tracking_no}</span>
          <small>{t(`status.${item.status}`)} · {item.location} · {formatTime(item.time, i18n.language)}</small>
        </button>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
