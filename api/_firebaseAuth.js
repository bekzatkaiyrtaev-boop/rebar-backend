// api/_firebaseAuth.js
// Проверка Firebase ID-токена (вход PSD PRO) через Identity Toolkit —
// тот же приём, что уже используется в contact.js, без лишних npm-пакетов.
// Нужна эндпоинтам, которым требуется реальный вход пользователя (а не
// просто статический x-app-key), например styki-lookup.js. Книги
// sortament/climat/materials/agsk эту проверку не используют и трогать их
// не нужно — см. memory project-sheet-data-auth-tradeoff.

// Веб-ключ Firebase не секретный (он лежит в site-header.js открыто);
// токен проверяется именно в проекте psdpro-1326b, чужие токены не пройдут.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyD02B2uoqs_SfG8qk8jY8WPjSTL4Iip2ZU';

// Возвращает { email, name } по ID-токену или null, если токен отсутствует/недействителен
export async function verifyFirebaseToken(req) {
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
