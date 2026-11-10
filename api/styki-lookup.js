// api/styki-lookup.js
// Данные "Стыки стальных элементов" (PSD PRO, серия 2.400-10.1) —
// защищённый вариант sheet-data.js: источник — отдельная таблица
// "База стыков 2.400-10.1", требует вход PSD PRO (Firebase ID-токен),
// и сервер сам фильтрует данные — браузер получает только узкий результат
// запроса, а не всю таблицу (2996 строк) целиком.
//
// Действия (action):
//   schemes                         — список типов профилей (10 строк, справочно)
//   steels   + scheme_id            — марки стали для данного типа профиля
//   profiles + scheme_id + steel    — список сечений (id, profile, status)
//   record   + id                   — одна запись целиком (все поля детали стыка)
//
// Требуется переменная окружения GOOGLE_STYKI_SHEET_ID — ID таблицы
// "База стыков 2.400-10.1" (лист "Стыки" — данные, "Схемы" — справочник
// типов). Таблица должна быть расшарена на тот же сервис-аккаунт, что и
// другие книги (GOOGLE_SERVICE_ACCOUNT_JSON).
import { google } from "googleapis";
import { checkRateLimit } from "./_rateLimit.js";
import { applyCors } from "./_cors.js";
import { verifyFirebaseToken } from "./_firebaseAuth.js";

const SPREADSHEET_ID = process.env.GOOGLE_STYKI_SHEET_ID;
const CACHE_TTL_MS = 5 * 60 * 1000;

const NUMERIC_FIELDS = new Set([
  "element_B", "element_b", "element_t",
  "d1_angle_no", "d1_B", "d1_b", "d1_t", "d1_l", "d1_mass", "d1_weld_k",
  "d2_b", "d2_t", "d2_l", "d2_mass", "d2_weld_k",
  "spacer_b1", "spacer_l1", "spacer_b2", "spacer_l2",
  "source_table", "source_page", "source_djvu_page", "source_row",
]);

let cachedSheetsClient = null;
async function getSheetsClient() {
  if (cachedSheetsClient) return cachedSheetsClient;
  const rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCreds) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не задан в переменных окружения");
  const credentials = JSON.parse(rawCreds);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

// Конвенция обоих листов этой таблицы: строка 1 — machine-readable ключи,
// данные со строки 2 (проще, чем row5/row6/row7 у sortament/climat — эта
// таблица задумана отдельно и сразу под этот эндпоинт).
function rowsToRecords(rows) {
  const keys = rows[0] || [];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
    .map((row) => {
      const record = {};
      keys.forEach((key, i) => {
        if (!key) return;
        let value = row[i] !== undefined ? row[i] : "";
        if (NUMERIC_FIELDS.has(key)) {
          if (value === "") {
            value = null;
          } else if (typeof value === "string") {
            const n = Number(value.replace(",", "."));
            value = Number.isFinite(n) ? n : value;
          }
        }
        record[key] = value;
      });
      return record;
    });
}

let cache = { rows: null, schemes: null, fetchedAt: 0 };

async function loadData() {
  if (cache.rows && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const sheets = await getSheetsClient();
  const [dataResp, schemesResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Стыки" }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Схемы" }),
  ]);
  cache = {
    rows: rowsToRecords(dataResp.data.values || []),
    schemes: rowsToRecords(schemesResp.data.values || []),
    fetchedAt: Date.now(),
  };
  return cache;
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Метод не поддерживается, используйте GET" });
    return;
  }

  const rl = checkRateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    res.status(429).json({ error: "Слишком много запросов, попробуйте позже" });
    return;
  }

  const user = await verifyFirebaseToken(req);
  if (!user) {
    res.status(401).json({ error: "Требуется вход в PSD PRO" });
    return;
  }

  if (!SPREADSHEET_ID) {
    res.status(500).json({ error: "Переменная окружения GOOGLE_STYKI_SHEET_ID не задана" });
    return;
  }

  try {
    const { action, scheme_id, steel, id } = req.query;
    const { rows, schemes } = await loadData();

    if (action === "schemes") {
      const usedIds = new Set(rows.map((r) => r.scheme_id));
      res.status(200).json({
        schemes: schemes.filter((s) => usedIds.has(s.id)),
        count: rows.length,
      });
      return;
    }

    if (action === "steels") {
      if (!scheme_id) {
        res.status(400).json({ error: "Не указан scheme_id" });
        return;
      }
      const steels = [...new Set(rows.filter((r) => r.scheme_id === scheme_id).map((r) => r.element_steel))];
      res.status(200).json({ steels });
      return;
    }

    if (action === "profiles") {
      if (!scheme_id || !steel) {
        res.status(400).json({ error: "Не указаны scheme_id и steel" });
        return;
      }
      const profiles = rows
        .filter((r) => r.scheme_id === scheme_id && r.element_steel === steel)
        .map((r) => ({ id: r.id, profile: r.profile, status: r.status }));
      res.status(200).json({ profiles });
      return;
    }

    if (action === "record") {
      if (!id) {
        res.status(400).json({ error: "Не указан id" });
        return;
      }
      const record = rows.find((r) => r.id === id) || null;
      if (!record) {
        res.status(404).json({ error: "Запись не найдена" });
        return;
      }
      res.status(200).json({ record });
      return;
    }

    res.status(400).json({ error: "Неизвестное действие action" });
  } catch (err) {
    console.error("styki-lookup error:", err);
    res.status(500).json({ error: "Не удалось получить данные" });
  }
}
