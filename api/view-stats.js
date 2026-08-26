// api/view-stats.js
// GET-эндпоинт для страницы статистики ЭСК (statistika.html) — агрегирует
// лист "Просмотры" (Дата | Страница) в разбивку по страницам:
// сегодня / этот месяц / всего.
//
// Требует переменные окружения:
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   GOOGLE_USERS_SHEET_ID
import { google } from 'googleapis';
import { checkRateLimit } from './_rateLimit.js';

const VIEWS_SHEET = 'Просмотры';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не поддерживается, используйте GET' });
  }

  const rl = checkRateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_USERS_SHEET_ID;

    let rows = [];
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${VIEWS_SHEET}!A2:B`,
      });
      rows = result.data.values || [];
    } catch (e) {
      rows = []; // лист "Просмотры" ещё не создан — просмотров пока не было
    }

    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }); // YYYY-MM-DD
    const monthStr = todayStr.slice(0, 7); // YYYY-MM

    const stats = new Map();
    for (const row of rows) {
      const [dateStr, page] = row;
      if (!page) continue;
      if (!stats.has(page)) stats.set(page, { page, today: 0, month: 0, total: 0 });
      const s = stats.get(page);
      s.total += 1;
      if (dateStr && dateStr.startsWith(monthStr)) s.month += 1;
      if (dateStr === todayStr) s.today += 1;
    }

    const list = Array.from(stats.values()).sort((a, b) => b.total - a.total);
    return res.status(200).json({ pages: list });
  } catch (err) {
    console.error('Ошибка чтения статистики просмотров:', err);
    return res.status(500).json({ error: 'Не удалось получить статистику' });
  }
}
