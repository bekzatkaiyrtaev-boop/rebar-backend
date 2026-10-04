// api/contact.js
// Эндпоинт формы обратной связи со страницы "Об авторе"
// Требует переменную окружения RESEND_API_KEY (Vercel → Settings → Environment Variables)
// Пакет: npm install resend

import { Resend } from 'resend';
import { applyCors } from './_cors.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  try {
    const { name, email, message, topic } = req.body || {};

    // Базовая валидация
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный e-mail' });
    }
    if (name.length > 200 || message.length > 5000 || (topic && String(topic).length > 200)) {
      return res.status(400).json({ error: 'Слишком длинный текст' });
    }

    // Получатель и отправитель настраиваются через переменные окружения Vercel.
    // CONTACT_TO — куда приходят обращения (по умолчанию прежний Gmail).
    // CONTACT_FROM — адрес отправителя; на домен psdpro.kz переключать только после
    // подтверждения домена в Resend, иначе Resend отклонит письма.
    // Пока домен не подтверждён, onboarding@resend.dev умеет слать только на почту
    // владельца аккаунта Resend, поэтому CONTACT_TO менять рано.
    const to = process.env.CONTACT_TO || 'esk.bekzat@gmail.com';
    const from = process.env.CONTACT_FROM || 'PSD PRO — форма обратной связи <onboarding@resend.dev>';
    const topicLine = topic ? `Тема: ${topic}\n` : '';

    const { data, error } = await resend.emails.send({
      // Через reply_to при нажатии "Ответить" письмо уйдёт автору обращения напрямую.
      from,
      to,
      replyTo: email,
      subject: `[PSD PRO] ${topic ? topic + ' — ' : ''}${name}`,
      text: `${topicLine}Имя: ${name}\nE-mail: ${email}\n\nСообщение:\n${message}`,
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
