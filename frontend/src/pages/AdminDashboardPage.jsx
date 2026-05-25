import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, apiErrorMessage } from '../api';
import { formatTime } from '../shared/ui.jsx';

const STATUS_LABELS = {
  CREATED: '已创建',
  WAREHOUSE_RECEIVED: '仓库已收货',
  CHINA_TRANSIT: '中国运输中',
  AT_BORDER: '已到边境',
  CUSTOMS_CLEARANCE: '清关中',
  MYANMAR_TRANSIT: '缅甸运输中',
  OUT_FOR_DELIVERY: '派送中',
  DELIVERED: '已签收',
  EXCEPTION: '异常',
  RETURNED: '已退回',
};

const EXCEPTION_LABELS = {
  LOST: '丢失',
  DAMAGED: '破损',
  CUSTOMS_HOLD: '海关扣留',
  ADDRESS_ISSUE: '地址问题',
  CONTACT_ISSUE: '联系不上',
  REJECTED: '拒收',
  DELAY: '延迟',
  OTHER: '其他',
};

function DashboardSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function KpiCard({ label, value, hint, tone = 'default' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <strong>{value ?? '-'}</strong>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function SimpleBar({ label, value, max, tone = '' }) {
  const width = max > 0 ? Math.max(4, Math.round((Number(value || 0) / max) * 100)) : 0;
  return (
    <div className="dashboard-bar-row">
      <span>{label}</span>
      <div className="dashboard-bar-track"><i className={tone} style={{ width: `${width}%` }} /></div>
      <strong>{value || 0}</strong>
    </div>
  );
}

export default function AdminDashboardPage({ navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  async function load() {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/dashboard/stats');
      if (requestId !== requestIdRef.current) return;
      setData(response.data.data);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(apiErrorMessage(err));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const maxStatus = useMemo(() => Math.max(...Object.values(data?.status_breakdown || { empty: 0 }), 0), [data]);
  const maxExceptionType = useMemo(() => Math.max(...Object.values(data?.exception_stats?.by_type || { empty: 0 }), 0), [data]);
  const maxSeverity = useMemo(() => Math.max(...Object.values(data?.exception_stats?.by_severity || { empty: 0 }), 0), [data]);

  if (loading && !data) return <section className="panel"><DashboardSkeleton /></section>;

  return (
    <section className="admin-dashboard-page">
      <div className="panel">
        <div className="section-head">
          <div>
            <p className="muted">HX MM Operations</p>
            <h1>运营仪表盘</h1>
          </div>
          <button className="ghost-button" type="button" onClick={load} disabled={loading}>{loading ? '刷新中' : '刷新'}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="metric-grid dashboard-kpi-grid">
        <KpiCard label="运单总数" value={data?.shipment_stats?.total || 0} />
        <KpiCard label="今日新增" value={data?.shipment_stats?.today || 0} tone="success" />
        <KpiCard label="本周新增" value={data?.shipment_stats?.this_week || 0} tone="border" />
        <KpiCard label="本月新增" value={data?.shipment_stats?.this_month || 0} tone="warning" />
        <KpiCard label="待处理异常" value={data?.exception_stats?.total_open || 0} tone="danger" />
      </div>

      <div className="admin-dashboard-grid">
        <section className="panel form-stack">
          <div className="section-head">
            <h2>物流状态分布</h2>
            <button className="ghost-button" type="button" onClick={() => navigate('/admin')}>查看运单</button>
          </div>
          {Object.entries(data?.status_breakdown || {}).map(([status, count]) => (
            <SimpleBar key={status} label={STATUS_LABELS[status] || status} value={count} max={maxStatus} tone={status === 'EXCEPTION' ? 'danger' : ''} />
          ))}
        </section>

        <section className="panel form-stack">
          <div className="section-head">
            <h2>异常统计</h2>
            <button className="ghost-button" type="button" onClick={() => navigate('/admin/exceptions')}>处理异常</button>
          </div>
          {Object.entries(data?.exception_stats?.by_type || {}).map(([type, count]) => (
            <SimpleBar key={type} label={EXCEPTION_LABELS[type] || type} value={count} max={maxExceptionType} />
          ))}
          <div className="severity-grid">
            {Object.entries(data?.exception_stats?.by_severity || {}).map(([severity, count]) => (
              <span className={`status-pill severity-${severity.toLowerCase()}`} key={severity}>{severity}: {count}</span>
            ))}
          </div>
        </section>

        <section className="panel form-stack">
          <h2>批次状态</h2>
          <div className="metric-grid compact-metrics">
            <KpiCard label="总批次" value={data?.batch_stats?.total || 0} />
            <KpiCard label="待发车" value={data?.batch_stats?.pending || 0} tone="warning" />
            <KpiCard label="运输中" value={data?.batch_stats?.departed || 0} tone="border" />
            <KpiCard label="已到达" value={data?.batch_stats?.arrived || 0} tone="success" />
          </div>
        </section>

        <section className="panel form-stack">
          <h2>配送时效</h2>
          <div className="metric-grid compact-metrics">
            <KpiCard label="准时率" value={`${data?.delivery_performance?.on_time_rate ?? 0}%`} tone="success" />
            <KpiCard label="平均时效" value={data?.delivery_performance?.avg_delivery_hours === null ? '-' : `${data?.delivery_performance?.avg_delivery_hours || 0}h`} />
          </div>
          {(data?.delivery_performance?.by_route || []).map((route) => (
            <div className="history-row" key={route.route}>
              <span>{route.route}</span>
              <small>{route.avg_hours ?? '-'}h · {route.count} 单</small>
            </div>
          ))}
        </section>

        <section className="panel form-stack dashboard-wide-panel">
          <h2>最近操作</h2>
          {(data?.recent_activities || []).map((activity, index) => (
            <div className="history-row" key={`${activity.time}-${index}`}>
              <span>{activity.description}</span>
              <small>{activity.user} · {formatTime(activity.time, 'zh')}</small>
            </div>
          ))}
          {!(data?.recent_activities || []).length && <p className="muted">暂无操作记录</p>}
        </section>
      </div>
    </section>
  );
}
