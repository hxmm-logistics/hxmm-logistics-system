import React, { useEffect, useRef, useState } from 'react';
import { apiClient, apiErrorMessage } from '../api';
import { formatTime } from '../shared/ui.jsx';

const EXCEPTION_TYPES = [
  ['LOST', '丢失'],
  ['DAMAGED', '破损'],
  ['CUSTOMS_HOLD', '海关扣留'],
  ['ADDRESS_ISSUE', '地址问题'],
  ['CONTACT_ISSUE', '联系不上收件人'],
  ['REJECTED', '拒收'],
  ['DELAY', '延迟'],
  ['OTHER', '其他'],
];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES = ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'];

function severityClass(severity) {
  return `severity-${String(severity || 'MEDIUM').toLowerCase()}`;
}

function statusClass(status) {
  return `exception-status-${String(status || 'PENDING').toLowerCase()}`;
}

function typeLabel(type) {
  return EXCEPTION_TYPES.find(([value]) => value === type)?.[1] || type || '-';
}

function nextActions(status) {
  if (status === 'PENDING') return [{ action: 'process', label: '开始处理' }, { action: 'resolve', label: '标记解决' }];
  if (status === 'PROCESSING') return [{ action: 'resolve', label: '标记解决' }];
  if (status === 'RESOLVED') return [{ action: 'close', label: '关闭' }];
  return [];
}

function Field({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="section-head">
          <h2>{title}</h2>
          <button className="ghost-button" type="button" onClick={onClose}>关闭</button>
        </div>
        {children}
      </section>
    </div>
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

export default function AdminExceptionsPage({ navigate }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 1 });
  const [filters, setFilters] = useState(() => ({
    status: sessionStorage.getItem('hx_mm_exception_status') || '',
    exception_type: sessionStorage.getItem('hx_mm_exception_type') || '',
    severity: sessionStorage.getItem('hx_mm_exception_severity') || '',
    tracking_no: sessionStorage.getItem('hx_mm_exception_tracking_no') || '',
  }));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const requestIdRef = useRef(0);

  async function resolveShipmentId(trackingNo) {
    const normalized = String(trackingNo || '').trim();
    if (!normalized) return null;
    const response = await apiClient.get(`/shipment/${encodeURIComponent(normalized)}`);
    return response.data?.id || null;
  }

  async function load(page = pagination.page, nextFilters = filters) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setMessage('');
    try {
      sessionStorage.setItem('hx_mm_exception_status', nextFilters.status || '');
      sessionStorage.setItem('hx_mm_exception_type', nextFilters.exception_type || '');
      sessionStorage.setItem('hx_mm_exception_severity', nextFilters.severity || '');
      sessionStorage.setItem('hx_mm_exception_tracking_no', nextFilters.tracking_no || '');

      let shipmentId = null;
      if (nextFilters.tracking_no.trim()) {
        shipmentId = await resolveShipmentId(nextFilters.tracking_no);
        if (!shipmentId) {
          if (requestId === requestIdRef.current) {
            setItems([]);
            setPagination({ page: 1, limit: 20, total: 0, total_pages: 1 });
            setMessage('未查询到该运单的异常记录');
          }
          return;
        }
      }

      const response = await apiClient.get('/exceptions', {
        params: {
          page,
          limit: pagination.limit || 20,
          status: nextFilters.status || undefined,
          exception_type: nextFilters.exception_type || undefined,
          severity: nextFilters.severity || undefined,
          shipment_id: shipmentId || undefined,
        },
      });
      if (requestId !== requestIdRef.current) return;
      setItems(response.data.exceptions || []);
      setPagination(response.data.pagination || { page, limit: 20, total: 0, total_pages: 1 });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessage(apiErrorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load(1, filters);
  }, []);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function submitFilters(event) {
    event.preventDefault();
    load(1, filters);
  }

  async function openDetail(item) {
    setMessage('');
    try {
      const response = await apiClient.get(`/exceptions/${item.id}`);
      setSelected(response.data.exception);
    } catch (error) {
      setMessage(apiErrorMessage(error));
    }
  }

  async function runAction(exceptionItem, action, note = '') {
    setMessage('');
    try {
      await apiClient.post(`/exceptions/${exceptionItem.id}/${action}`, { note });
      const detail = await apiClient.get(`/exceptions/${exceptionItem.id}`);
      setSelected(detail.data.exception);
      await load(pagination.page, filters);
      setMessage('操作已完成');
    } catch (error) {
      setMessage(apiErrorMessage(error));
    }
  }

  return (
    <section className="admin-exceptions-page">
      <div className="panel form-stack">
        <div className="section-head">
          <div>
            <p className="muted">HX MM Operations</p>
            <h1>异常管理</h1>
          </div>
          <button type="button" onClick={() => setReportOpen(true)}>上报异常</button>
        </div>

        <form className="exception-filters" onSubmit={submitFilters}>
          <input value={filters.tracking_no} onChange={(event) => updateFilter('tracking_no', event.target.value)} placeholder="搜索运单号" />
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">全部状态</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filters.exception_type} onChange={(event) => updateFilter('exception_type', event.target.value)}>
            <option value="">全部类型</option>
            {EXCEPTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={filters.severity} onChange={(event) => updateFilter('severity', event.target.value)}>
            <option value="">全部严重程度</option>
            {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <button type="submit" disabled={loading}>{loading ? '查询中' : '查询'}</button>
        </form>
        {message && <p className={message.includes('完成') || message.includes('上报') ? 'notice' : 'error'}>{message}</p>}
      </div>

      <div className="panel">
        <div className="section-head">
          <h2>异常列表</h2>
          <button className="ghost-button" type="button" onClick={() => load(pagination.page, filters)}>刷新</button>
        </div>
        {loading ? <ListSkeleton /> : (
          <div className="table-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>运单号</th>
                  <th>异常类型</th>
                  <th>严重程度</th>
                  <th>状态</th>
                  <th>上报人</th>
                  <th>上报时间</th>
                  <th>处理人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {!items.length && <tr><td colSpan="9" className="empty-cell">暂无异常记录</td></tr>}
                {items.map((item) => (
                  <tr key={item.id} onDoubleClick={() => openDetail(item)}>
                    <td>{item.id}</td>
                    <td>
                      <button className="link-button" type="button" onClick={() => navigate(`/shipment/${item.tracking_no || item.platform_tracking_no || item.hx_no}`)}>
                        {item.tracking_no || item.platform_tracking_no || item.hx_no || '-'}
                      </button>
                    </td>
                    <td>{typeLabel(item.exception_type)}</td>
                    <td><span className={`status-pill ${severityClass(item.severity)}`}>{item.severity}</span></td>
                    <td><span className={`status-pill ${statusClass(item.status)}`}>{item.status}</span></td>
                    <td>{item.reporter_name || '-'}</td>
                    <td>{formatTime(item.created_at, 'zh')}</td>
                    <td>{item.handler_name || '-'}</td>
                    <td>
                      <div className="table-actions">
                        <button className="ghost-button" type="button" onClick={() => openDetail(item)}>处理</button>
                        {nextActions(item.status).slice(0, 1).map((action) => (
                          <button key={action.action} type="button" onClick={() => runAction(item, action.action)}>{action.label}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination-row">
          <button className="ghost-button" disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1, filters)}>上一页</button>
          <span>第 {pagination.page} / {Math.max(pagination.total_pages || 1, 1)} 页 · 共 {pagination.total || 0} 条</span>
          <button className="ghost-button" disabled={pagination.page >= (pagination.total_pages || 1) || loading} onClick={() => load(pagination.page + 1, filters)}>下一页</button>
        </div>
      </div>

      {selected && <ExceptionDetailModal exceptionItem={selected} onClose={() => setSelected(null)} onAction={runAction} navigate={navigate} />}
      {reportOpen && <ReportExceptionModal onClose={() => setReportOpen(false)} onCreated={async () => { setReportOpen(false); await load(1, filters); setMessage('异常已上报'); }} />}
    </section>
  );
}

function ExceptionDetailModal({ exceptionItem, onClose, onAction, navigate }) {
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const actions = nextActions(exceptionItem.status);

  async function submitAction(action) {
    setBusyAction(action);
    try {
      await onAction(exceptionItem, action, note);
      setNote('');
    } finally {
      setBusyAction('');
    }
  }

  return (
    <Modal title={`异常详情 #${exceptionItem.id}`} onClose={onClose}>
      <dl className="info-grid">
        <Field label="运单号" value={exceptionItem.tracking_no || exceptionItem.platform_tracking_no || exceptionItem.hx_no} />
        <Field label="批次号" value={exceptionItem.batch_number} />
        <Field label="异常类型" value={typeLabel(exceptionItem.exception_type)} />
        <Field label="严重程度" value={exceptionItem.severity} />
        <Field label="状态" value={exceptionItem.status} />
        <Field label="上报人" value={exceptionItem.reporter_name} />
        <Field label="上报时间" value={formatTime(exceptionItem.created_at, 'zh')} />
        <Field label="处理人" value={exceptionItem.handler_name} />
      </dl>
      <div className="exception-description">
        <strong>异常描述</strong>
        <p>{exceptionItem.description}</p>
      </div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写处理备注" rows="4" />
      <div className="button-row">
        <button className="ghost-button" type="button" onClick={() => navigate(`/shipment/${exceptionItem.tracking_no || exceptionItem.platform_tracking_no || exceptionItem.hx_no}`)}>查看运单</button>
        {actions.map((action) => (
          <button key={action.action} type="button" disabled={Boolean(busyAction)} onClick={() => submitAction(action.action)}>
            {busyAction === action.action ? '处理中' : action.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ReportExceptionModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ tracking_no: '', exception_type: 'DAMAGED', severity: 'MEDIUM', description: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const trackingNo = form.tracking_no.trim();
      const shipmentResponse = await apiClient.get(`/shipment/${encodeURIComponent(trackingNo)}`);
      const shipmentId = shipmentResponse.data?.id;
      if (!shipmentId) throw new Error('未查询到运单');
      await apiClient.post('/exceptions', {
        shipment_id: shipmentId,
        batch_id: null,
        exception_type: form.exception_type,
        severity: form.severity,
        description: form.description.trim(),
      });
      await onCreated();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="上报异常" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <input value={form.tracking_no} onChange={(event) => update('tracking_no', event.target.value)} placeholder="运单号" required />
        <select value={form.exception_type} onChange={(event) => update('exception_type', event.target.value)}>
          {EXCEPTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={form.severity} onChange={(event) => update('severity', event.target.value)}>
          {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </select>
        <textarea value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="异常详细描述" rows="5" required />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? '提交中' : '提交异常'}</button>
      </form>
    </Modal>
  );
}
