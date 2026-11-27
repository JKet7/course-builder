import { verifyToken } from '../utils/jwt.js';

/**
 * Проверяет Bearer-токен и кладёт данные пользователя в req.user.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, login: payload.login, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ message: 'Недействительный или истёкший токен' });
  }
}

/**
 * Разрешает доступ только указанным ролям (admin | editor | reader).
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Требуется авторизация' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Недостаточно прав' });
    }
    return next();
  };
}

/** Готовый набор middleware для редакторских роутов: router.post('/', editorOnly, ...) */
export const editorOnly = [requireAuth, requireRole('admin', 'editor')];
