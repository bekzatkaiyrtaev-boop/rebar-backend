// api/sheet-data.js
// Endpoint: GET /api/sheet-data?book=КНИГА&sheet=ИМЯ_ЛИСТА
// book: sortament (по умолчанию) | climat
// Конвенция листа: строка 5 — machine-readable ключи, строка 6 — подписи, данные с 7-й строки

import { google } from "googleapis";

// Соответствие параметра book и переменной окружения с ID таблицы
const BOOK_ENV_MAP = {
  sortament: "GOOGLE_SHEET_ID",
  climat: "GOOGLE_CLIMAT_SHEET_ID",
};

// Кэшируем авторизованный клиент между вызовами (в рамках "тёплого" инстанса Vercel)
let cachedSheetsClient = null;

async function getSheetsClient() {
  if (cachedSheetsClient) return cachedSheetsClient;

  const rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCreds) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не задан в переменных окружения");
  }

  const credentials = JSON.parse(rawCreds);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

export default async function handler(req, res) {
  // CORS — разрешаем запросы с фронтенда на Vercel
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Метод не поддерживается, используйте GET" });
    return;
  }

  // Проверка секретного ключа — отсекает прямые обращения к API мимо сайта
  const APP_SECRET = process.env.APP_SECRET;
  if (APP_SECRET && req.headers["x-app-key"] !== APP_SECRET) {
    res.status(403).json({ error: "Доступ запрещён" });
    return;
  }

  try {
    const { book = "sortament", sheet } = req.query;

    if (!sheet) {
      res.status(400).json({ error: "Не указан параметр sheet" });
      return;
    }

    const envKey = BOOK_ENV_MAP[book];
    if (!envKey) {
      res.status(400).json({ error: `Неизвестная книга: ${book}` });
      return;
    }

    const spreadsheetId = process.env[envKey];
    if (!spreadsheetId) {
      res.status(500).json({ error: `Переменная окружения ${envKey} не задана` });
      return;
    }

    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheet, // весь лист целиком
    });

    const rows = response.data.values || [];

    // Строка 5 (индекс 4) — machine-readable ключи
    // Строка 6 (индекс 5) — человекочитаемые подписи
    // Данные начинаются со строки 7 (индекс 6)
    const keys = rows[4] || [];
    const labels = rows[5] || [];
    const dataRows = rows.slice(6);

    const records = dataRows
      .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
      .map((row) => {
        const record = {};
        keys.forEach((key, i) => {
          if (key) record[key] = row[i] !== undefined ? row[i] : "";
        });
        return record;
      });

    res.status(200).json({
      book,
      sheet,
      keys,
      labels,
      count: records.length,
      records,
    });
  } catch (err) {
    console.error("Ошибка sheet-data:", err);
    res.status(500).json({ error: err.message || "Внутренняя ошибка сервера" });
  }
}
