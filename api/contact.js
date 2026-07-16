// api/contact.js
// Эндпоинт формы обратной связи со страницы "Об авторе"
// Требует переменную окружения RESEND_API_KEY (Vercel → Settings → Environment Variables)
// Пакет: npm install resend

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Разрешённый источник запросов — домен сайта справочника
const ALLOWED_ORIGIN = 'https://esk-kz.vercel.app';

module.exports = async function handler(req, res) {
  // CORS
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
    const { name, email, message } = req.body || {};

    // Базовая валидация
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный e-mail' });
    }
    if (name.length > 200 || message.length > 5000) {
      return res.status(400).json({ error: 'Слишком длинный текст' });
    }

    await resend.emails.send({
      // Технический адрес отправителя от Resend — домен esk-kz.vercel.app не верифицирован,
      // поэтому письмо формально уходит от onboarding@resend.dev.
      // Через reply_to при нажатии "Ответить" письмо уйдёт автору обращения напрямую.
      from: 'ЭСК — форма обратной связи <onboarding@resend.dev>',
      to: 'esk_kz@bk.ru',
      reply_to: email,
      subject: `Сообщение с сайта ЭСК от ${name}`,
      text: `Имя: ${name}\nE-mail: ${email}\n\nСообщение:\n${message}`,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Ошибка отправки письма:', err);
    return res.status(500).json({ error: 'Не удалось отправить письмо' });
  }
};
