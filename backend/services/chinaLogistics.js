const borderKeywords = ['清水河', '瑞丽', '木姐', '边境', '口岸'];
const customsKeywords = ['清关', '海关', '报关'];
const exceptionKeywords = ['异常', '退回', '拒收', '丢失', '延误'];

export function normalizeChinaStatus(rawText = '') {
  if (exceptionKeywords.some((word) => rawText.includes(word))) {
    return 'EXCEPTION';
  }
  if (customsKeywords.some((word) => rawText.includes(word))) {
    return 'CUSTOMS';
  }
  if (borderKeywords.some((word) => rawText.includes(word))) {
    return 'AT_BORDER';
  }
  if (rawText.includes('签收')) {
    return 'DELIVERED';
  }
  if (rawText.includes('揽收') || rawText.includes('运输') || rawText.includes('派送') || rawText.includes('到达')) {
    return 'IN_CHINA_TRANSIT';
  }
  return 'PENDING';
}

export async function fetchChinaTracking(chinaCarrierCode, chinaTrackingNo) {
  const provider = process.env.CHINA_LOGISTICS_PROVIDER || 'mock';

  if (provider === 'kuaidi100') {
    return fetchFromKuaidi100(chinaCarrierCode, chinaTrackingNo);
  }

  if (provider === 'kdniao') {
    return fetchFromKdniao(chinaCarrierCode, chinaTrackingNo);
  }

  return mockChinaTracking(chinaCarrierCode, chinaTrackingNo);
}

async function fetchFromKuaidi100(chinaCarrierCode, chinaTrackingNo) {
  if (!process.env.KUAIDI100_CUSTOMER || !process.env.KUAIDI100_KEY) {
    throw new Error('KUAIDI100_CUSTOMER and KUAIDI100_KEY are required');
  }

  return {
    rawStatus: `快递100待配置公司编码，单号 ${chinaTrackingNo}`,
    location: '中国',
    remark: `已配置快递100环境变量后，可用 ${chinaCarrierCode} + ${chinaTrackingNo} 接入查询接口。`,
  };
}

async function fetchFromKdniao(chinaCarrierCode, chinaTrackingNo) {
  if (!process.env.KDNIAO_EBUSINESS_ID || !process.env.KDNIAO_APP_KEY) {
    throw new Error('KDNIAO_EBUSINESS_ID and KDNIAO_APP_KEY are required');
  }

  return {
    rawStatus: `快递鸟待配置快递公司编码，单号 ${chinaTrackingNo}`,
    location: '中国',
    remark: `已配置快递鸟环境变量后，可用 ${chinaCarrierCode} + ${chinaTrackingNo} 接入查询接口。`,
  };
}

function mockChinaTracking(chinaCarrierCode, chinaTrackingNo) {
  if (!chinaCarrierCode || !chinaTrackingNo) {
    return null;
  }

  return {
    rawStatus: '中国快递已揽收，运输中',
    location: '中国',
    remark: `MVP 模拟中国物流同步：${chinaCarrierCode} + ${chinaTrackingNo}`,
  };
}
