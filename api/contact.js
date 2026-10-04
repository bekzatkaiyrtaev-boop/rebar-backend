// api/contact.js
// Эндпоинт формы обратной связи со страницы "Связаться" на psdpro.kz.
// Писать могут только зарегистрированные пользователи: фронтенд присылает
// Firebase ID-токен в заголовке Authorization: Bearer <token>, мы проверяем его
// через Identity Toolkit (проект psdpro-1326b), без дополнительных пакетов.
// Файлы нигде не хранятся — пересылаются вложениями в письме через Resend.
// Требует переменную окружения RESEND_API_KEY (Vercel → Settings → Environment Variables)
// Необязательные: CONTACT_TO, CONTACT_FROM, FIREBASE_API_KEY.

import { Resend } from 'resend';
import { applyCors } from './_cors.js';
import { checkRateLimit } from './_rateLimit.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Веб-ключ Firebase не секретный (он лежит в site-header.js открыто);
// токен проверяется именно в этом проекте, чужие токены не пройдут.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyD02B2uoqs_SfG8qk8jY8WPjSTL4Iip2ZU';

// Vercel Serverless Functions ограничивают тело запроса ~4.5 МБ — держим суммарный
// размер исходных файлов (до base64) с запасом под это ограничение.
const MAX_FILES = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;
// Только безопасные форматы: документы, чертежи, изображения, таблицы, архивы
const ALLOWED_EXT = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'dwg', 'dxf', 'xls', 'xlsx', 'doc', 'docx', 'zip', 'rar', '7z',
]);

// Возвращает данные пользователя Firebase по ID-токену или null, если токен недействителен
async function verifyFirebaseUser(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: match[1] }),
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const user = data && data.users && data.users[0];
  if (!user || !user.email) return null;
  return { email: user.email, name: user.displayName || '' };
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const rl = checkRateLimit(req, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов, попробуйте позже' });
  }

  try {
    // Только для зарегистрированных пользователей
    const user = await verifyFirebaseUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Войдите на сайте, чтобы отправить сообщение' });
    }

    const { name, phone, message, topic, attachments } = req.body || {};

    // Базовая валидация
    if (!message) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (
      (name && String(name).length > 200) ||
      (phone && String(phone).length > 50) ||
      String(message).length > 5000 ||
      (topic && String(topic).length > 200)
    ) {
      return res.status(400).json({ error: 'Слишком длинный текст' });
    }

    // Вложения: до 3 файлов, ≤3 МБ суммарно, только разрешённые форматы
    const files = Array.isArray(attachments) ? attachments : [];
    if (files.length > MAX_FILES) {
      return res.status(400).json({ error: `Можно прикрепить не более ${MAX_FILES} файлов` });
    }
    let totalBytes = 0;
    const resendAttachments = [];
    for (const f of files) {
      if (!f || typeof f.filename !== 'string' || typeof f.contentBase64 !== 'string') {
        return res.status(400).json({ error: 'Некорректный формат вложения' });
      }
      // Оставляем только имя файла, без путей и служебных символов
      const filename = f.filename.split(/[\\/]/).pop().replace(/[^\w.\-() а-яА-ЯёЁ]/g, '_').slice(0, 120);
      const ext = (filename.split('.').pop() || '').toLowerCase();
      if (!filename.includes('.') || !ALLOWED_EXT.has(ext)) {
        return res.status(400).json({
          error: 'Недопустимый формат файла. Разрешены: ' + [...ALLOWED_EXT].join(', '),
        });
      }
      totalBytes += Math.ceil((f.contentBase64.length * 3) / 4);
      resendAttachments.push({ filename, content: f.contentBase64 });
    }
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return res.status(413).json({
        error: 'Суммарный размер файлов слишком большой (лимит ~3 МБ) — приложите ссылку на облако вместо файла',
      });
    }

    // Получатель и отправитель настраиваются через переменные окружения Vercel.
    // CONTACT_TO — куда приходят обращения (по умолчанию прежний Gmail, пока переменная не задана).
    // CONTACT_FROM — адрес отправителя на подтверждённом в Resend домене send.psdpro.kz.
    const to = process.env.CONTACT_TO || 'esk.bekzat@gmail.com';
    const from = process.env.CONTACT_FROM || 'PSD PRO — форма обратной связи <onboarding@resend.dev>';

    // Имя — из формы, иначе из профиля, иначе из почты
    const senderName = String(name || user.name || user.email.split('@')[0]).trim();
    const topicLine = topic ? `Тема: ${topic}\n` : '';
    const phoneLine = phone ? `Телефон: ${phone}\n` : '';

    const { data, error } = await resend.emails.send({
      // Через reply_to при нажатии "Ответить" письмо уйдёт автору обращения напрямую.
      // Адрес берём из проверенной учётной записи, а не из тела запроса.
      from,
      to,
      replyTo: user.email,
      subject: `[PSD PRO] ${topic ? topic + ' — ' : ''}${senderName}`,
      text: `${topicLine}Имя: ${senderName}\nE-mail (аккаунт): ${user.email}\n${phoneLine}\nСообщение:\n${message}`,
      attachments: resendAttachments.length ? resendAttachments : undefined,
    });

    if (error) {
      console.error('Resend вернул ошибку:', error);
      return res.status(500).json({ error: error.message || 'Resend отклонил письмо' });
    }

    return res.status(200).json({ ok: true, id: data && data.id });
  } catch (err) {
    console.error('Ошибка отправки письма:', err);
    return res.status(500).json({ error: 'Не удалось отправить письмо' });
  }
}
