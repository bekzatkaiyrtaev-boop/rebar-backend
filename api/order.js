// api/order.js
// Эндпоинт формы "Заказать расчёт или проект" со страницы forum.html
// Файлы нигде не хранятся — пересылаются вложениями в письме через Resend.
// Требует переменную окружения RESEND_API_KEY (Vercel → Settings → Environment Variables)

import { Resend } from 'resend';
import { checkRateLimit } from './_rateLimit.js';
import { applyCors } from './_cors.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel Serverless Functions ограничивают тело запроса ~4.5 МБ — держим
// суммарный размер исходных файлов (до base64) с запасом под это ограничение.
const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export default async function handler(req, res) {
  applyCors(req, res);

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
    const { name, email, phone, deadline, budget, description, attachments } = req.body || {};

    // Базовая валидация — сроки и стоимость необязательны
    if (!name || !email || !phone || !description) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный e-mail' });
    }
    if (
      name.length > 200 ||
      phone.length > 50 ||
      (deadline && deadline.length > 200) ||
      (budget && budget.length > 200) ||
      description.length > 5000
    ) {
      return res.status(400).json({ error: 'Слишком длинный текст в одном из полей' });
    }

    const files = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    let totalBytes = 0;
    for (const f of files) {
      if (!f || typeof f.filename !== 'string' || typeof f.contentBase64 !== 'string') {
        return res.status(400).json({ error: 'Некорректный формат вложения' });
      }
      totalBytes += Math.ceil((f.contentBase64.length * 3) / 4);
    }
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return res.status(413).json({
        error: 'Суммарный размер файлов слишком большой (лимит ~3 МБ) — приложите ссылку на облако вместо файла',
      });
    }

    const resendAttachments = files.map((f) => ({ filename: f.filename, content: f.contentBase64 }));

    const { data, error } = await resend.emails.send({
      // Технический адрес отправителя от Resend — домен esk-kz.vercel.app не верифицирован,
      // поэтому письмо формально уходит от onboarding@resend.dev.
      // Через reply_to при нажатии "Ответить" письмо уйдёт заказчику напрямую.
      from: 'ЭСК — заявка на расчёт <onboarding@resend.dev>',
      to: 'esk.bekzat@gmail.com',
      replyTo: email,
      subject: `Заявка на расчёт/проект от ${name}`,
      text:
        `Имя: ${name}\n` +
        `E-mail: ${email}\n` +
        `Телефон: ${phone}\n` +
        `Сроки выполнения: ${deadline || 'не указаны'}\n` +
        `Стоимость (предложение заказчика): ${budget || 'не указана'}\n\n` +
        `Описание задачи / исходные данные:\n${description}`,
      attachments: resendAttachments.length ? resendAttachments : undefined,
    });

    if (error) {
      console.error('Resend вернул ошибку:', error);
      return res.status(500).json({ error: error.message || 'Resend отклонил письмо' });
    }

    return res.status(200).json({ ok: true, id: data && data.id });
  } catch (err) {
    console.error('Ошибка отправки заявки:', err);
    return res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
}
