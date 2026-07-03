// Чтение данных из Google Sheets
// ?sheet=имя_листа  — обязательный параметр
// ?book=sortament   — книга (по умолчанию sortament, также: climat)

import { google } from 'googleapis';

const SPREADSHEET_IDS = {
  sortament: process.env.GOOGLE_SHEET_ID,
  climat:    process.env.GOOGLE_CLIMAT_SHEET_ID,
};

let SERVICE_ACCOUNT_EMAIL = '';
let PRIVATE_KEY = '';
try {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '');
  SERVICE_ACCOUNT_EMAIL = creds.client_email;
  PRIVATE_KEY = creds.private_key;
} catch (e) {}

const ALLOWED_SHEET_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const ALLOWED_BOOKS = new Set(Object.keys(SPREADSHEET_IDS));

async function getSheetClient() {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL, null, PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function rowsToObjects(rows) {
  const keys = rows[0];
  const result = [];
  for (const row of rows.slice(2)) {
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
    res.status(400).json({ error: 'Unknown or missing sheet parameter' }); return;
  }
  if (!ALLOWED_BOOKS.has(bookName)) {
    res.status(400).json({ error: `Unknown book: ${bookName}` }); return;
  }

  const spreadsheetId = SPREADSHEET_IDS[bookName];
  if (!spreadsheetId || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    res.status(500).json({ error: 'Server is not configured (missing env vars)' }); return;
  }

  try {
    const sheets = await getSheetClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A5:CZ500`
    });
    const rows = response.data.values || [];
    if (rows.length < 3) {
      res.status(200).json({ book: bookName, sheet: sheetName, data: [] }); return;
    }
    const data = rowsToObjects(rows);
    res.status(200).json({ book: bookName, sheet: sheetName, count: data.length, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
