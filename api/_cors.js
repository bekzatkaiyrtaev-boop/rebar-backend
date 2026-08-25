// api/_cors.js
// Общий список разрешённых источников запросов. Сайт переехал с esk-kz.vercel.app
// на www.psdpro.kz (см. vercel.json — старый домен теперь 301-редиректит на новый),
// но оставляем оба в списке на переходный период.

const ALLOWED_ORIGINS = ['https://www.psdpro.kz', 'https://esk-kz.vercel.app'];

export function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
