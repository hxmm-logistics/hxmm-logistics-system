export const STATUSES = [
  'CREATED',
  'WAREHOUSE_RECEIVED',
  'CHINA_TRANSIT',
  'AT_BORDER',
  'CUSTOMS_CLEARANCE',
  'MYANMAR_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
  'RETURNED',
];

export const SOURCES = ['scan', 'system', 'admin'];

export const statusLabels = {
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

const LEGACY_STATUS_MAP = {
  PENDING: 'CREATED',
  IN_CHINA_WAREHOUSE: 'WAREHOUSE_RECEIVED',
  IN_CHINA_TRANSIT: 'CHINA_TRANSIT',
  CUSTOMS: 'CUSTOMS_CLEARANCE',
  IN_MYANMAR: 'MYANMAR_TRANSIT',
  INBOUND: 'WAREHOUSE_RECEIVED',
};

export function normalizeStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
}

export function assertStatus(status) {
  const normalized = normalizeStatus(status);
  if (!STATUSES.includes(normalized)) {
    const error = new Error(`Invalid status: ${status}`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function assertSource(source) {
  if (!SOURCES.includes(source)) {
    const error = new Error(`Invalid source: ${source}`);
    error.status = 400;
    throw error;
  }
}

const TRANSITIONS = {
  CREATED: ['WAREHOUSE_RECEIVED', 'EXCEPTION'],
  WAREHOUSE_RECEIVED: ['CHINA_TRANSIT', 'EXCEPTION'],
  CHINA_TRANSIT: ['AT_BORDER', 'EXCEPTION'],
  AT_BORDER: ['CUSTOMS_CLEARANCE', 'EXCEPTION'],
  CUSTOMS_CLEARANCE: ['MYANMAR_TRANSIT', 'EXCEPTION'],
  MYANMAR_TRANSIT: ['OUT_FOR_DELIVERY', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'EXCEPTION'],
  DELIVERED: [],
  EXCEPTION: [
    'CREATED',
    'WAREHOUSE_RECEIVED',
    'CHINA_TRANSIT',
    'AT_BORDER',
    'CUSTOMS_CLEARANCE',
    'MYANMAR_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'RETURNED',
  ],
  RETURNED: [],
};

export function canTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (!from) return STATUSES.includes(to);
  return TRANSITIONS[from]?.includes(to) || false;
}

export function assertTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (!canTransition(from, to)) {
    const error = new Error(`Invalid status transition: ${from || 'NULL'} -> ${to}`);
    error.status = 409;
    throw error;
  }
  return to;
}
