export const STATUSES = [
  'PENDING',
  'IN_CHINA_TRANSIT',
  'AT_BORDER',
  'CUSTOMS',
  'IN_MYANMAR',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
];

export const SOURCES = ['china_api', 'myanmar_scan', 'manual', 'system'];

export const statusLabels = {
  PENDING: '待处理',
  IN_CHINA_TRANSIT: '中国运输中',
  AT_BORDER: '已到边境',
  CUSTOMS: '清关中',
  IN_MYANMAR: '缅甸运输中',
  OUT_FOR_DELIVERY: '派送中',
  DELIVERED: '已签收',
  EXCEPTION: '异常',
};

export function assertStatus(status) {
  if (!STATUSES.includes(status)) {
    const error = new Error(`Invalid status: ${status}`);
    error.status = 400;
    throw error;
  }
}

export function assertSource(source) {
  if (!SOURCES.includes(source)) {
    const error = new Error(`Invalid source: ${source}`);
    error.status = 400;
    throw error;
  }
}

const TRANSITIONS = {
  PENDING: ['PENDING', 'IN_CHINA_TRANSIT', 'EXCEPTION'],
  IN_CHINA_TRANSIT: ['IN_CHINA_TRANSIT', 'AT_BORDER', 'EXCEPTION'],
  AT_BORDER: ['AT_BORDER', 'CUSTOMS', 'IN_MYANMAR', 'EXCEPTION'],
  CUSTOMS: ['CUSTOMS', 'IN_MYANMAR', 'EXCEPTION'],
  IN_MYANMAR: ['IN_MYANMAR', 'OUT_FOR_DELIVERY', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
  DELIVERED: ['DELIVERED'],
  EXCEPTION: ['PENDING', 'IN_CHINA_TRANSIT', 'AT_BORDER', 'CUSTOMS', 'IN_MYANMAR', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
};

export function canTransition(fromStatus, toStatus) {
  return TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

export function assertTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    const error = new Error(`Invalid status transition: ${fromStatus} -> ${toStatus}`);
    error.status = 409;
    throw error;
  }
}
