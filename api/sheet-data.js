// Чтение сортамента металлопроката из Google Sheets
// Лист определяется параметром ?sheet=dv_sh_gost (например)
// Конвенция листа: строки 1-4 — свободные пометки (игнорируются)
//                  строка 5   — машиночитаемые ключи полей
//                  строка 6   — человекочитаемые подписи (игнорируются здесь)
//                  строка 7+  — данные, до первой пустой строки в столбце A

import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// В Vercel переносы строк в private_key хранятся как "\n" (текстом) — разворачиваем обратно.
// Также на случай, если при копировании попали лишние кавычки по краям — срезаем их.
let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || '';
PRIVATE_KEY = PRIVATE_KEY.trim();
if (PRIVATE_KEY.startsWith('"') && PRIVATE_KEY.endsWith('"')) {
  PRIVATE_KEY = PRIVATE_KEY.slice(1, -1);
}
PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');

// Разрешённые имена листов — защита от произвольного чтения чужих диапазонов
const ALLOWED_SHEETS = new Set([
  'dv_b_gost', 'dv_b_sto',
  'dv_sh_gost', 'dv_sh_sto',
  'dv_k_gost', 'dv_k_sto',
  'shv_u', 'ug_r', 'ug_n',
  'tr_kv', 'tr_kr'
]);

async function getSheetClient() {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    null,
    PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function rowsToObjects(rows) {
  // rows[0] = строка 5 листа (ключи полей), rows[1] = строка 6 (подписи, пропускаем)
  // rows[2..] = данные с 7-й строки
  const keys = rows[0];
  const dataRows = rows.slice(2);

  const result = [];
  for (const row of dataRows) {
    if (!row[0]) break; // первая пустая ячейка в столбце A — конец таблицы
    const obj = {};
    keys.forEach((key, i) => {
      if (!key) return;
      const raw = row[i];
      if (raw === undefined || raw === '' || raw === '-') {
        obj[key] = null;
      } else {
        const num = Number(String(raw).replace(',', '.'));
        obj[key] = isNaN(num) ? raw : num;
      }
    });
    result.push(obj);
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const sheetName = req.query.sheet;
  if (!sheetName || !ALLOWED_SHEETS.has(sheetName)) {
    res.status(400).json({ error: 'Unknown or missing sheet parameter' });
    return;
  }
  if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    res.status(500).json({ error: 'Server is not configured (missing env vars)' });
    return;
  }

  try {
    const sheets = await getSheetClient();
    // Читаем от строки 5 до конца листа (запас в 500 строк с головой хватает под сортамент)
    const range = `${sheetName}!A5:BZ500`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });

    const rows = response.data.values || [];
    if (rows.length < 3) {
      res.status(200).json({ sheet: sheetName, data: [] });
      return;
    }

    const data = rowsToObjects(rows);
    res.status(200).json({ sheet: sheetName, count: data.length, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
