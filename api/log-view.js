// api/log-view.js
// Анонимный счётчик просмотров страниц ЭСК — не требует входа, вызывается
// с фронта (site-header.js) при каждом открытии ЛЮБОЙ страницы сайта.
// Пишет строку в лист "Просмотры" таблицы "ЭСК-пользователи": Дата | Страница.
//
// Требует переменные окружения:
//   GOOGLE_SERVICE_ACCOUNT_JSON — уже используется другими калькуляторами
//   GOOGLE_USERS_SHEET_ID       — ID таблицы "ЭСК-пользователи"
import { google } from 'googleapis';
import { applyCors } from './_cors.js';
import { checkRateLimit } from './_rateLimit.js';

const VIEWS_SHEET = 'Просмотры';
const VIEWS_HEADER = ['Дата', 'Страница'];

async function ensureSheetAndHeader(sheets, spreadsheetId, sheetName, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some(s => s.properties.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z1`,
  });
  const rows = readResult.data.values || [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] },
    });
  }
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const rl = checkRateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов' });
  }

  try {
    const { page } = req.body || {};
    if (!page) {
      return res.status(400).json({ error: 'Не передана страница' });
    }
    const pageLabel = String(page).trim().slice(0, 200);

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_USERS_SHEET_ID;

    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }); // YYYY-MM-DD

    await ensureSheetAndHeader(sheets, spreadsheetId, VIEWS_SHEET, VIEWS_HEADER);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${VIEWS_SHEET}!A:B`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[dateStr, pageLabel]] },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Ошибка записи просмотра:', err);
    return res.status(500).json({ error: 'Не удалось записать просмотр' });
  }
}
