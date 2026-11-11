// api/svai-lookup.js
// Данные "Сваи забивные ж.б." (ЭСК, серия 1.011.1-10, вып.1, ч.1) — открытый
// каталог (ЭСК без входа), поэтому в отличие от styki-lookup.js здесь НЕТ
// проверки Firebase-токена — только rate limit + Origin/Referer, как у
// остальных "открытых книг" (sheet-data.js).
//
// Источник — таблица "Сваи 1.011.1-10" (3 листа: "Сваи", "Сетки", "Петли").
// В отличие от sheet-data.js, здесь нет отдельной строки machine-readable
// ключей — только одна строка человекочитаемых заголовков (строка 6,
// данные с 7-й), поэтому сопоставление колонка → поле жёстко задано в коде
// (ниже), по фактическому порядку столбцов на листах.
//
// Действия (action):
//   list            — лёгкий список всех марок (id, mark, variant, lengthMm, sectionMm, massT)
//   record + id     — одна марка целиком, с присоединёнными Сетки/Петли
//
// Требуется переменная окружения GOOGLE_SVAI_SHEET_ID — ID таблицы "Сваи 1.011.1-10".
import { google } from "googleapis";
import { checkRateLimit } from "./_rateLimit.js";
import { applyCors, isAllowedOrigin } from "./_cors.js";

const SPREADSHEET_ID = process.env.GOOGLE_SVAI_SHEET_ID;
const CACHE_TTL_MS = 5 * 60 * 1000;
const HEADER_ROW_INDEX = 5; // строка 6 (0-indexed) — заголовки, данные с 7-й строки

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

// "3 000" (пробел — разделитель тысяч), "0,13" (запятая — десятичный разделитель),
// "—" / "" — пусто.   — неразрывный пробел, Google Sheets иногда его подставляет.
function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s === "—") return null;
  const n = Number(s.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" || s === "—" ? null : s;
}

function parsePiles(rows) {
  return rows
    .slice(HEADER_ROW_INDEX + 1)
    .filter((r) => r && r[0])
    .map((r) => {
      const variantLabel = r[1] || "";
      return {
        id: r[0],
        mark: r[0],
        variant: /\.1|Приставн/.test(variantLabel) ? "tip" : "integral",
        lengthMm: num(r[3]),
        sectionMm: num(r[4]),
        a1Mm: num(r[5]),
        a2Mm: num(r[6]),
        a3Mm: num(r[7]),
        massT: num(r[8]),
        concreteClass: str(r[9]),
        concreteM3: num(r[10]),
        steelKg: num(r[11]),
        longitudinalDiameterMm: num(r[12]),
        longitudinalClass: str(r[13]),
        longitudinalBarQty: num(r[14]),
        cage: str(r[15]),
        cageQty: num(r[16]),
        cageDocument: str(r[17]),
        tipCage: str(r[18]),
        tipCageQty: num(r[19]),
        tipCageDocument: str(r[20]),
        mesh: str(r[21]),
        meshQty: num(r[22]),
        meshPosition: num(r[23]),
        meshDocument: str(r[24]),
        loop: str(r[25]),
        loopQty: num(r[26]),
        loopPosition: num(r[27]),
        loopDocument: str(r[28]),
        extraPosition: num(r[29]),
        extraName: str(r[30]),
        extraDiameterMm: num(r[31]),
        extraClass: str(r[32]),
        extraLengthMm: num(r[33]),
        extraQty: num(r[34]),
        extraMassKg: num(r[35]),
        extraDocument: str(r[36]),
        // Иногда ссылается на несколько страниц сразу ("58, 59") — не число, строка.
        specSourcePage: str(r[37]),
        specFilePage: str(r[38]),
        geomSourcePage: str(r[39]),
        geomFilePage: str(r[40]),
      };
    });
}
function parseMeshes(rows) {
  return rows
    .slice(HEADER_ROW_INDEX + 1)
    .filter((r) => r && r[0])
    .map((r) => ({
      mark: r[0],
      diameterMm: num(r[1]),
      reinforcementClass: str(r[2]),
      lengthMm: num(r[3]),
      barQty: num(r[4]),
      massKg: num(r[5]),
      stepsMm: [r[6], r[7], r[8], r[9], r[10]].map(num).filter((v) => v !== null),
      // "Стр. серии" = printedPage (номер по серии), "Стр. файла" = sourcePage (скан) —
      // так же называлось в исходном JSON, сверено на "П1"/"С1".
      printedPage: num(r[15]),
      sourcePage: num(r[16]),
    }));
}
function parseLoops(rows) {
  return rows
    .slice(HEADER_ROW_INDEX + 1)
    .filter((r) => r && r[0])
    .map((r) => ({
      mark: r[0],
      diameterMm: num(r[1]),
      reinforcementClass: str(r[2]),
      lengthMm: num(r[3]),
      massKg: num(r[4]),
      barMassKg: num(r[5]),
      document: str(r[6]),
      // "Стр. серии" = printedPage, "Стр. файла" = sourcePage — printedPage
      // печатается прямо в карточке ("Чертёж ..., стр. ${l.printedPage}"),
      // перепутанные местами значения сверены и исправлены на "П1".
      printedPage: num(r[7]),
      sourcePage: num(r[8]),
    }));
}

let cache = { piles: null, meshes: null, loops: null, fetchedAt: 0 };
async function loadData() {
  if (cache.piles && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const sheets = await getSheetsClient();
  const [pilesResp, meshResp, loopResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Сваи" }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Сетки" }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Петли" }),
  ]);
  cache = {
    piles: parsePiles(pilesResp.data.values || []),
    meshes: parseMeshes(meshResp.data.values || []),
    loops: parseLoops(loopResp.data.values || []),
    fetchedAt: Date.now(),
  };
  return cache;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Метод не поддерживается, используйте GET" });
    return;
  }

  const rl = checkRateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    res.status(429).json({ error: "Слишком много запросов, попробуйте позже" });
    return;
  }

  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: "Доступ запрещён" });
    return;
  }

  if (!SPREADSHEET_ID) {
    res.status(500).json({ error: "Переменная окружения GOOGLE_SVAI_SHEET_ID не задана" });
    return;
  }

  try {
    const { action, id } = req.query;
    const { piles, meshes, loops } = await loadData();

    if (action === "list") {
      res.status(200).json({
        count: piles.length,
        items: piles.map((p) => ({
          id: p.id,
          mark: p.mark,
          variant: p.variant,
          lengthMm: p.lengthMm,
          sectionMm: p.sectionMm,
          massT: p.massT,
        })),
      });
      return;
    }

    if (action === "record") {
      if (!id) {
        res.status(400).json({ error: "Не указан id" });
        return;
      }
      const p = piles.find((x) => x.id === id);
      if (!p) {
        res.status(404).json({ error: "Марка не найдена" });
        return;
      }
      const meshData = meshes.find((m) => m.mark === p.mesh) || null;
      const loopData = loops.find((l) => l.mark === p.loop) || null;
      const extraComponents = p.extraName
        ? [
            {
              position: p.extraPosition,
              name: p.extraName,
              diameter: p.extraDiameterMm,
              reinforcementClass: p.extraClass,
              lengthMm: p.extraLengthMm,
              massKg: p.extraMassKg,
              quantity: p.extraQty,
              document: p.extraDocument,
            },
          ]
        : [];
      res.status(200).json({ record: { ...p, meshData, loopData, extraComponents } });
      return;
    }

    res.status(400).json({ error: "Неизвестное действие action" });
  } catch (err) {
    console.error("svai-lookup error:", err);
    res.status(500).json({ error: "Не удалось получить данные" });
  }
}
