const CARRIERS = [
  { code: 'YTO', name: '圆通速递', patterns: [/^YT/i, /^YTO/i] },
  { code: 'JT', name: '极兔速递', patterns: [/^JT/i, /^JNT/i] },
  { code: 'SF', name: '顺丰速运', patterns: [/^SF/i] },
  { code: 'ZTO', name: '中通快递', patterns: [/^ZTO/i] },
  { code: 'YUNDA', name: '韵达快递', patterns: [/^YD/i, /^YUNDA/i] },
  { code: 'STO', name: '申通快递', patterns: [/^STO/i] },
];

export function normalizeTrackingNo(value = '') {
  return String(value).trim().replace(/\s+/g, '').toUpperCase();
}

export function detectCarrier(trackingNo) {
  const normalized = normalizeTrackingNo(trackingNo);
  const carrier = CARRIERS.find((item) => item.patterns.some((pattern) => pattern.test(normalized)));
  if (carrier) return { carrier_code: carrier.code, carrier_name: carrier.name };
  return { carrier_code: 'UNKNOWN', carrier_name: '未识别物流公司' };
}