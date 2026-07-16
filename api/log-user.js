// api/log-user.js
// Эндпоинт учёта пользователей, вошедших через Google на сайте ЭСК.
// Дописывает строку (Дата, Имя, Email) в таблицу "ЭСК-пользователи", лист Users.
// Требует переменные окружения:
//   GOOGLE_SERVICE_ACCOUNT_JSON — уже используется другими калькуляторами
//   GOOGLE_USERS_SHEET_ID       — ID новой таблицы "ЭСК-пользователи"

import { google } from 'googleapis';

const ALLOWED_ORIGIN = 'https://esk-kz.vercel.app';
const SHEET_NAME = 'Users';

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
    const { name, email } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: 'Не переданы имя или email' });
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_USERS_SHEET_ID,
      range: `${SHEET_NAME}!A:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, name, email]],
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Ошибка записи пользователя:', err);
    return res.status(500).json({ error: 'Не удалось записать пользователя' });
  }
}
