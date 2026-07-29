// api/log-user.js
// Эндпоинт учёта пользователей, вошедших на сайте ЭСК (Firebase Auth:
// Google / email+пароль / ссылка на почту).
//
// Пишет в ДВА листа таблицы "ЭСК-пользователи":
//   Users — одна строка на email: Email | Первая авторизация | Последний вход | Входов | Имя
//   Log   — сырой лог событий для статистики: Дата | Время | Email | Тип | Метод | Страница
//           (это событие "Вход" — Метод заполнен, Страница пустая)
//
// Требует переменные окружения:
//   GOOGLE_SERVICE_ACCOUNT_JSON — уже используется другими калькуляторами
//   GOOGLE_USERS_SHEET_ID       — ID таблицы "ЭСК-пользователи"
import { google } from 'googleapis';

const ALLOWED_ORIGIN = 'https://esk-kz.vercel.app';
const USERS_SHEET = 'Users';
const LOG_SHEET = 'Log';
const USERS_HEADER = ['Email', 'Первая авторизация', 'Последний вход', 'Входов', 'Имя'];
const LOG_HEADER = ['Дата', 'Время', 'Email', 'Тип', 'Метод', 'Страница'];

// Читаемые подписи для способа входа (то, что придёт с фронта в поле method)
const METHOD_LABELS = {
  google: 'Google',
  password: 'Почта и пароль',
  link: 'Ссылка на почту',
};

async function ensureSheetAndHeader(sheets, spreadsheetId, sheetName, header) {
  // Проверяем, есть ли такая вкладка в таблице вообще
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
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  try {
    const { name, email, method } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Не передан email' });
    }
    const emailNormalized = String(email).trim().toLowerCase();
    const displayName = name || emailNormalized.split('@')[0];
    const methodLabel = METHOD_LABELS[method] || (method || 'не указан');

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
    const timestampForUsers = `${dateStr} ${timeStr}`;

    // ── 1. Обновляем сводку в Users ──
    await ensureSheetAndHeader(sheets, spreadsheetId, USERS_SHEET, USERS_HEADER);

    const usersRead = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${USERS_SHEET}!A:E`,
    });
    const usersRows = usersRead.data.values || [];

    let foundRowIndex = -1;
    for (let i = 1; i < usersRows.length; i++) {
      const rowEmail = (usersRows[i][0] || '').trim().toLowerCase();
      if (rowEmail === emailNormalized) {
        foundRowIndex = i;
        break;
      }
    }

    if (foundRowIndex === -1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${USERS_SHEET}!A:E`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[emailNormalized, timestampForUsers, timestampForUsers, 1, displayName]],
        },
      });
    } else {
      const existingRow = usersRows[foundRowIndex];
      const firstSeen = existingRow[1] || timestampForUsers;
      const prevCount = parseInt(existingRow[3], 10) || 0;
      const sheetRowNumber = foundRowIndex + 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${USERS_SHEET}!A${sheetRowNumber}:E${sheetRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[emailNormalized, firstSeen, timestampForUsers, prevCount + 1, displayName]],
        },
      });
    }

    // ── 2. Пишем событие "Вход" в Log (для статистики по дням/методам) ──
    await ensureSheetAndHeader(sheets, spreadsheetId, LOG_SHEET, LOG_HEADER);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${LOG_SHEET}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[dateStr, timeStr, emailNormalized, 'Вход', methodLabel, '']],
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Ошибка записи пользователя:', err);
    return res.status(500).json({ error: 'Не удалось записать пользователя' });
  }
}
