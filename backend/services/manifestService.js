function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Rangoon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function renderInfoItem(label, value) {
  return `
    <div class="info-item">
      <span class="label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
    </div>
  `;
}

export function renderBatchManifestHtml({ batch, shipments }) {
  const totalParcels = shipments.reduce((sum, shipment) => sum + Number(shipment.package_count || 1), 0);
  const rows = shipments.map((shipment, index) => {
    const trackingNo = shipment.tracking_no || shipment.china_tracking_no || shipment.platform_tracking_no || shipment.hx_no || '';
    const carrierName = shipment.carrier_name || shipment.china_carrier_name || shipment.carrier_code || shipment.china_carrier_code || '';
    const receiverName = shipment.receiver_name || shipment.customer_name || '';
    const receiverPhone = shipment.receiver_phone || shipment.customer_phone || '';
    const receiverAddress = shipment.receiver_address || shipment.current_node || shipment.current_location || '';
    const packageCount = shipment.package_count || 1;
    const remark = shipment.remark || shipment.note || '';

    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(trackingNo)}</td>
        <td>${escapeHtml(carrierName)}</td>
        <td>${escapeHtml(receiverName)}</td>
        <td>${escapeHtml(receiverPhone)}</td>
        <td>${escapeHtml(receiverAddress)}</td>
        <td class="center">${escapeHtml(packageCount)}</td>
        <td>${escapeHtml(remark)}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HX MM 司机交接单 - ${escapeHtml(batch.batch_number)}</title>
  <style>
    :root {
      color: #111827;
      background: #f4f6f8;
      font-family: Arial, "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; }
    .page {
      max-width: 1120px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d9dee7;
      padding: 28px;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 2px solid #111827;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
    .brand { font-size: 13px; color: #4b5563; margin-top: 6px; }
    .print-button {
      appearance: none;
      border: 1px solid #111827;
      background: #111827;
      color: #fff;
      border-radius: 6px;
      padding: 9px 14px;
      font-size: 14px;
      cursor: pointer;
    }
    .section { margin-top: 18px; }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      margin: 0 0 10px;
      border-left: 4px solid #111827;
      padding-left: 8px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-top: 1px solid #d9dee7;
      border-left: 1px solid #d9dee7;
    }
    .info-item {
      min-height: 58px;
      padding: 10px 12px;
      border-right: 1px solid #d9dee7;
      border-bottom: 1px solid #d9dee7;
    }
    .label { display: block; color: #6b7280; font-size: 12px; margin-bottom: 6px; }
    strong { font-size: 14px; word-break: break-word; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #d9dee7;
      padding: 9px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    th { background: #f3f4f6; font-weight: 700; }
    .center { text-align: center; }
    .stats {
      display: flex;
      gap: 24px;
      font-size: 15px;
      padding: 12px 0;
    }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      margin-top: 36px;
      font-size: 15px;
    }
    .signature-line {
      border-bottom: 1px solid #111827;
      height: 34px;
      margin-top: 12px;
    }
    .footer-note {
      margin-top: 22px;
      color: #6b7280;
      font-size: 12px;
    }
    @media print {
      body { padding: 0; background: #fff; }
      .page { max-width: none; border: 0; padding: 0; }
      .print-button { display: none; }
      .topbar { margin-bottom: 14px; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      .section { page-break-inside: avoid; }
    }
    @media (max-width: 720px) {
      body { padding: 10px; }
      .page { padding: 14px; }
      .topbar { flex-direction: column; }
      .info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { font-size: 12px; }
      th, td { padding: 7px 6px; }
      .signatures { grid-template-columns: 1fr; gap: 14px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <div>
        <h1>司机交接单</h1>
        <div class="brand">HX MM Cross-border Logistics Manifest</div>
      </div>
      <button class="print-button" type="button" onclick="window.print()">打印 / 另存为 PDF</button>
    </header>

    <section class="section">
      <h2 class="section-title">批次信息</h2>
      <div class="info-grid">
        ${renderInfoItem('批次号', batch.batch_number)}
        ${renderInfoItem('批次状态', batch.status)}
        ${renderInfoItem('发车仓库', batch.departure_warehouse)}
        ${renderInfoItem('到达仓库', batch.arrival_warehouse)}
        ${renderInfoItem('发车时间', formatDateTime(batch.departure_time))}
        ${renderInfoItem('到达时间', formatDateTime(batch.arrival_time))}
        ${renderInfoItem('创建时间', formatDateTime(batch.created_at))}
        ${renderInfoItem('更新时间', formatDateTime(batch.updated_at))}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">司机信息</h2>
      <div class="info-grid">
        ${renderInfoItem('司机姓名', batch.driver_name)}
        ${renderInfoItem('司机电话', batch.driver_phone)}
        ${renderInfoItem('车牌号', batch.vehicle_number)}
        ${renderInfoItem('车辆类型', batch.vehicle_type)}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">运单列表</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 48px;">序号</th>
            <th style="width: 150px;">运单号</th>
            <th style="width: 90px;">承运商</th>
            <th style="width: 90px;">收货人</th>
            <th style="width: 120px;">收货人电话</th>
            <th>收货地址</th>
            <th style="width: 72px;">包裹数量</th>
            <th style="width: 110px;">备注</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="8" class="center">暂无运单</td></tr>'}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">统计信息</h2>
      <div class="stats">
        <div>总包裹数：<strong>${escapeHtml(shipments.length)}</strong></div>
        <div>总件数：<strong>${escapeHtml(totalParcels)}</strong></div>
      </div>
    </section>

    <section class="signatures">
      <div>发车仓签名：<div class="signature-line"></div></div>
      <div>司机签名：<div class="signature-line"></div></div>
      <div>到达仓签名：<div class="signature-line"></div></div>
    </section>

    <div class="footer-note">本交接单由 HX MM 系统生成。若需 PDF，请使用浏览器打印功能选择“另存为 PDF”。</div>
  </main>
</body>
</html>`;
}
