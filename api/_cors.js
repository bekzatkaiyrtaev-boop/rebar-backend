// api/_cors.js
// Общий список разрешённых источников запросов. Сайт переехал с esk-kz.vercel.app
// на www.psdpro.kz (см. vercel.json — старый домен теперь 301-редиректит на новый),
// но оставляем оба в списке на переходный период. esk.psdpro.kz — отдельный поддомен
// ЭСК (climat.html, podbor-uteplitelya.html и др. тоже дёргают этот бэкенд напрямую).

const ALLOWED_ORIGINS = ['https://www.psdpro.kz', 'https://psdpro.kz', 'https://esk.psdpro.kz', 'https://esk-kz.vercel.app'];
const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/; // локальная разработка/превью

export function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || LOCALHOST_RE.test(origin || '') ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');
}

// Отсекает прямые обращения к API мимо сайта (curl/скрипт с подсмотренным ключом) —
// CORS-заголовки это НЕ делают (CORS проверяет только браузер, не сервер), поэтому
// нужна отдельная серверная проверка Origin/Referer. Не абсолютная защита (оба
// заголовка подделываемы в ручном запросе), но отсекает подавляющее большинство
// случайных попыток скопировать запрос без лишних заголовков.
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return ALLOWED_ORIGINS.includes(origin) || LOCALHOST_RE.test(origin);
  const referer = req.headers.referer;
  if (referer) return ALLOWED_ORIGINS.some((o) => referer.startsWith(o + '/')) || LOCALHOST_RE.test(referer.split('/').slice(0, 3).join('/'));
  return false; // ни Origin, ни Referer — типичная картина прямого curl/скрипта
}
