#!/usr/bin/env node

const BASE_URL = (process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const USERNAME = process.env.ACCEPTANCE_USERNAME || 'admin';
const PASSWORD = process.env.ACCEPTANCE_PASSWORD || 'admin123456';
const RUN_ID = Date.now();

let token = '';
const state = {};
const results = [];
let blocked = false;

function log(message) {
  console.log(`[HX MM acceptance] ${message}`);
}

function pass(name) {
  results.push({ name, ok: true });
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  results.push({ name, ok: false, error: error.message || String(error) });
  console.error(`FAIL ${name}: ${error.message || error}`);
  process.exitCode = 1;
}

function skip(name, reason) {
  results.push({ name, ok: false, skipped: true, error: reason });
  console.error(`SKIP ${name}: ${reason}`);
  process.exitCode = 1;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok && !options.allowStatus?.includes(response.status)) {
    const message = typeof data === 'object' && data?.error ? data.error : text || response.statusText;
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { response, data };
}

async function run(name, fn) {
  if (blocked) {
    skip(name, 'blocked by failed prerequisite');
    return;
  }
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
    if (name === 'health check' || name === 'login') blocked = true;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueTracking(prefix = 'YT') {
  return `${prefix}${RUN_ID}${Math.floor(Math.random() * 1000)}`;
}

await run('health check', async () => {
  const { data } = await request('/health');
  assert(data?.ok === true, 'health ok must be true');
  assert(data?.database === 'ok', 'database must be ok');
});

await run('login', async () => {
  const { data } = await request('/auth/login', {
    method: 'POST',
    body: { username: USERNAME, password: PASSWORD },
  });
  token = data.token;
  assert(token, 'login must return token');
});

await run('create shipment', async () => {
  state.createdTrackingNo = uniqueTracking('YT');
  const { data } = await request('/shipment/create', {
    method: 'POST',
    body: {
      china_tracking_no: state.createdTrackingNo,
      china_carrier_code: 'YTO',
      china_carrier_name: '圆通速递',
      customer_name: 'Acceptance Customer',
      customer_phone: '+95900000001',
      current_location: '广州仓',
    },
  });
  state.createdShipment = data;
  assert(data?.id, 'created shipment must include id');
  assert(data?.tracking_no === state.createdTrackingNo, 'created tracking_no mismatch');
});

await run('PDA receive', async () => {
  state.pdaTrackingNo = uniqueTracking('JT');
  const { data } = await request('/shipments/inbound-scan', {
    method: 'POST',
    body: {
      tracking_no: state.pdaTrackingNo,
      warehouse_name: '广州仓',
      current_node: '广州仓已入库',
    },
  });
  state.pdaShipment = data.shipment;
  assert(data.success === true, 'PDA receive must succeed');
  assert(state.pdaShipment?.id, 'PDA shipment id missing');
});

await run('tracking query and aggregation', async () => {
  const { data } = await request(`/public/tracking/${encodeURIComponent(state.pdaTrackingNo)}`);
  assert(data?.success === true, 'public tracking must succeed');
  assert(Array.isArray(data.timeline), 'timeline must be array');
  assert(data.shipment?.current_status === 'WAREHOUSE_RECEIVED', `expected WAREHOUSE_RECEIVED, got ${data.shipment?.current_status}`);
});

await run('illegal transition rejected', async () => {
  const illegalTrackingNo = uniqueTracking('SF');
  const inbound = await request('/shipments/inbound-scan', {
    method: 'POST',
    body: { tracking_no: illegalTrackingNo, warehouse_name: '广州仓', current_node: '广州仓已入库' },
  });
  const shipment = inbound.data.shipment;
  assert(shipment?.id, 'illegal transition fixture shipment missing');
  const { response } = await request('/tracking_events', {
    method: 'POST',
    allowStatus: [409],
    body: {
      tracking_no: illegalTrackingNo,
      event_code: 'DELIVER',
      event_city: '仰光',
      event_description: '非法直接签收测试',
      source_type: 'admin',
    },
  });
  assert(response.status === 409, `expected 409, got ${response.status}`);
});

await run('batch create', async () => {
  const { data } = await request('/batches', {
    method: 'POST',
    body: {
      driver_name: 'Acceptance Driver',
      driver_phone: '+95900000002',
      vehicle_number: 'TEST-001',
      vehicle_type: '货车',
      departure_warehouse: '广州仓',
      arrival_warehouse: '曼德勒仓',
      route_id: null,
    },
  });
  state.batch = data.batch;
  assert(data.success === true, 'batch create must succeed');
  assert(state.batch?.id, 'batch id missing');
});

await run('batch add shipment', async () => {
  const { data } = await request(`/batches/${state.batch.id}/add-shipments`, {
    method: 'POST',
    body: { shipment_ids: [state.pdaShipment.id] },
  });
  assert(data.success === true, 'add shipments must succeed');
  assert(data.added_count >= 1, 'expected at least one added shipment');
});

await run('batch depart', async () => {
  const { data } = await request(`/batches/${state.batch.id}/depart`, { method: 'POST' });
  assert(data.success === true, 'batch depart must succeed');
  assert(data.batch.status === 'DEPARTED', 'batch status must be DEPARTED');
  assert(data.events_created >= 1, 'depart must create tracking event');
});

await run('prepare batch arrival lifecycle', async () => {
  await request('/tracking_events', {
    method: 'POST',
    body: {
      tracking_no: state.pdaTrackingNo,
      event_code: 'BORDER_ARRIVE',
      event_city: '瑞丽 / 木姐口岸',
      event_description: '到达边境',
      source_type: 'admin',
    },
  });
  await request('/tracking_events', {
    method: 'POST',
    body: {
      tracking_no: state.pdaTrackingNo,
      event_code: 'CUSTOMS_CLEAR',
      event_city: '木姐口岸',
      event_description: '清关完成',
      source_type: 'admin',
    },
  });
});

await run('batch arrive', async () => {
  const { data } = await request(`/batches/${state.batch.id}/arrive`, { method: 'POST' });
  assert(data.success === true, 'batch arrive must succeed');
  assert(data.batch.status === 'ARRIVED', 'batch status must be ARRIVED');
  assert(data.events_created >= 1, 'arrive must create tracking event');
});

await run('exception create', async () => {
  const { data } = await request('/exceptions', {
    method: 'POST',
    body: {
      shipment_id: state.pdaShipment.id,
      batch_id: state.batch.id,
      exception_type: 'DAMAGED',
      severity: 'HIGH',
      description: 'Acceptance test exception',
    },
  });
  assert(data.success === true, 'exception create must succeed');
  assert(data.exception?.id, 'exception id missing');
});

await run('dashboard stats', async () => {
  const { data } = await request('/dashboard/stats');
  assert(data.success === true, 'dashboard stats must succeed');
  assert(data.data?.shipment_stats, 'shipment_stats missing');
  assert(data.data?.status_breakdown, 'status_breakdown missing');
  assert(data.data?.exception_stats, 'exception_stats missing');
});

const failed = results.filter((item) => !item.ok);
log(`completed: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
