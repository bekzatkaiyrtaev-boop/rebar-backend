// Чтение данных из Google Sheets
// Лист определяется параметром ?sheet=dv_sh_gost
// Книга определяется параметром ?book=climat (по умолчанию — сортамент)
// Конвенция листа: строки 1-4 — свободные пометки (игнорируются)
//                  строка 5   — машиночитаемые ключи полей
//                  строка 6   — человекочитаемые подписи (игнорируются здесь)
//                  строка 7+  — данные, до первой пустой строки в столбце A

import { google } from 'googleapis';

// ID таблиц — каждая книга в своей переменной окружения
const SPREADSHEET_IDS = {
  sortament: process.env.GOOGLE_SHEET_ID,
  climat:    process.env.GOOGLE_CLIMAT_SHEET_ID,
};

let SERVICE_ACCOUNT_EMAIL = '';
let PRIVATE_KEY = '';
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  const creds = JSON.parse(raw);
  SERVICE_ACCOUNT_EMAIL = creds.client_email;
  PRIVATE_KEY = creds.private_key;
} catch (e) {}

// Разрешённые имена листов — латиница + цифры + подчёркивание
const ALLOWED_SHEET_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
// Разрешённые книги
const ALLOWED_BOOKS = new Set(Object.keys(SPREADSHEET_IDS));

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
  const keys = rows[0];
  const dataRows = rows.slice(2);
  const result = [];
  for (const row of dataRows) {
    if (!row[0]) break;
    const obj = {};
    keys.forEach((key, i) => {
      if (!key) return;
      const raw = row[i];
      if (raw === undefined || raw === '' || raw === '-') {
        obj[key] = null;
      } else {
        const cleaned = String(raw).replace(/[\s\u00A0]/g, '').replace(',', '.');
        const num = Number(cleaned);
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

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const sheetName = req.query.sheet;
  const bookName  = req.query.book || 'sortament';

  if (!sheetName || !ALLOWED_SHEET_PATTERN.test(sheetName)) {
    res.status(400).json({ error: 'Unknown or missing sheet parameter' });
    return;
  }
  if (!ALLOWED_BOOKS.has(bookName)) {
    res.status(400).json({ error: `Unknown book: ${bookName}` });
    return;
  }

  const spreadsheetId = SPREADSHEET_IDS[bookName];
  if (!spreadsheetId || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    res.status(500).json({ error: 'Server is not configured (missing env vars)' });
    return;
  }

  try {
    const sheets = await getSheetClient();
    const range = `${sheetName}!A5:CZ500`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];
    if (rows.length < 3) {
      res.status(200).json({ book: bookName, sheet: sheetName, data: [] });
      return;
    }
    const data = rowsToObjects(rows);
    res.status(200).json({ book: bookName, sheet: sheetName, count: data.length, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Лист определяется параметром ?sheet=dv_sh_gost (например)
// Конвенция листа: строки 1-4 — свободные пометки (игнорируются)
//                  строка 5   — машиночитаемые ключи полей
//                  строка 6   — человекочитаемые подписи (игнорируются здесь)
//                  строка 7+  — данные, до первой пустой строки в столбце A

import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Вместо двух отдельных переменных (email + ключ) используем одну — с содержимым
// всего JSON-файла service account целиком. JSON.parse сам корректно разворачивает
// "\n" внутри строки в настоящие переносы, поэтому проблем с форматом ключа не возникает.
let SERVICE_ACCOUNT_EMAIL = '';
let PRIVATE_KEY = '';
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  const creds = JSON.parse(raw);
  SERVICE_ACCOUNT_EMAIL = creds.client_email;
  PRIVATE_KEY = creds.private_key;
} catch (e) {
  // Переменная не задана или невалидный JSON — обработается ниже в handler
}

// Разрешённые имена листов — любое имя из латиницы и подчёркиваний длиной 2-40 символов.
// Ничего менять в коде при добавлении нового листа не нужно —
// просто создайте лист в Google Sheets по той же конвенции именования.
const ALLOWED_SHEET_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

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
        // Убираем пробелы-разделители тысяч (обычные и неразрывные), затем запятую → точку
        const cleaned = String(raw).replace(/[\s\u00A0]/g, '').replace(',', '.');
        const num = Number(cleaned);
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
  if (!sheetName || !ALLOWED_SHEET_PATTERN.test(sheetName)) {
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
