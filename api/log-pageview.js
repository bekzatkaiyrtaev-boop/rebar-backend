// api/log-pageview.js
// Эндпоинт учёта просмотров страниц-калькуляторов ЭСК и PSD PRO.
// Вызывается с фронта (site-header.js) при каждом открытии страницы
// уже вошедшим пользователем. Пишет строку в лист "Log" той же таблицы,
// что и log-user.js: Дата | Время | Email | Тип | Метод | Страница | Сайт
// (для просмотра Тип='Просмотр', Метод пустой, Страница заполнена).
//
// Поле site в теле запроса — "ЭСК" или "PSD PRO" (по умолчанию "ЭСК" для
// обратной совместимости со старым фронтендом, который его ещё не шлёт).
//
// Требует переменные окружения:
//   GOOGLE_SERVICE_ACCOUNT_JSON — уже используется другими калькуляторами
//   GOOGLE_USERS_SHEET_ID       — ID таблицы "ЭСК-пользователи"
import { google } from 'googleapis';
import { applyCors } from './_cors.js';

const LOG_SHEET = 'Log';
const LOG_HEADER = ['Дата', 'Время', 'Email', 'Тип', 'Метод', 'Страница', 'Сайт'];

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

  try {
    const { email, page, site } = req.body || {};
    if (!email || !page) {
      return res.status(400).json({ error: 'Не переданы email или страница' });
    }
    const emailNormalized = String(email).trim().toLowerCase();
    const pageLabel = String(page).trim();
    const siteLabel = site || 'ЭСК';

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_USERS_SHEET_ID;

    const now = new Date();
    const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty' });

    await ensureSheetAndHeader(sheets, spreadsheetId, LOG_SHEET, LOG_HEADER);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${LOG_SHEET}!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[dateStr, timeStr, emailNormalized, 'Просмотр', '', pageLabel, siteLabel]],
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Ошибка записи просмотра страницы:', err);
    return res.status(500).json({ error: 'Не удалось записать просмотр' });
  }
}
