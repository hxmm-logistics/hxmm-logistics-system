function clientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
  next();
}

export function createRateLimiter({ windowMs, max, keyGenerator, message }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : clientIp(req);
    const existing = buckets.get(key);

    if (!existing || now > existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));

    if (existing.count > max) {
      return res.status(429).json({
        error: message || 'Too many requests',
        retry_after_seconds: retryAfter,
      });
    }

    return next();
  };
}

export const loginRateLimit = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 8),
  keyGenerator: (req) => `${clientIp(req)}:${req.body?.username || 'unknown'}`,
  message: 'Too many login attempts. Please retry later.',
});

export const apiRateLimit = createRateLimiter({
  windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.API_RATE_LIMIT_MAX || 240),
  keyGenerator: (req) => clientIp(req),
  message: 'Too many API requests. Please slow down.',
});
