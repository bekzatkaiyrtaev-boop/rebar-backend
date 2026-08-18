// api/_rateLimit.js
// Простой rate limiter в памяти "тёплого" инстанса Vercel — без внешних сервисов
// и БД. Не даёт железной гарантии (сбрасывается при холодном старте функции,
// не общий между параллельными инстансами под нагрузкой), но останавливает
// наивный перебор скриптом по одному IP.

const buckets = new Map();
let lastSweep = Date.now();

function sweep(windowMs) {
  const now = Date.now();
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [ip, bucket] of buckets) {
    if (now - bucket.start > windowMs) buckets.delete(ip);
  }
}

export function checkRateLimit(req, { limit = 60, windowMs = 60_000 } = {}) {
  sweep(windowMs);
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(ip, { start: now, count: 1 });
    return { ok: true };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.start + windowMs - now) / 1000) };
  }
  return { ok: true };
}
