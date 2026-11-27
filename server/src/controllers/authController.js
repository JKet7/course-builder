import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import prisma from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';

/** Служебная запись для входа без пароля («Войти, как читатель»). */
const GUEST_LOGIN = 'Гость';
const GUEST_ROLE = 'reader';

const toPublicUser = (user) => ({
  id: user.id,
  login: user.login,
  role: user.role,
  activeThemeId: user.activeThemeId,
});

/** POST /api/auth/login — выдача JWT по логину и паролю. */
export async function login(req, res) {
  const { login, password } = req.body;

  const user = await prisma.user.findUnique({ where: { login } });

  if (!user) {
    return res.status(401).json({ message: 'Неверный логин или пароль' });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    return res.status(401).json({ message: 'Неверный логин или пароль' });
  }

  console.log(`[auth] login ok: ${user.login} (${user.role})`);

  return res.json({ token: signToken(user), user: toPublicUser(user) });
}

/** GET /api/auth/me — данные текущего пользователя (для восстановления сессии). */
export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  if (!user) {
    return res.status(401).json({ message: 'Пользователь не найден' });
  }

  return res.json({ user: toPublicUser(user) });
}

/**
 * POST /api/auth/guest — вход в режиме «только просмотр», без логина и пароля.
 * Служебная запись создаётся один раз и получает случайный пароль, поэтому
 * войти под ней через /auth/login нельзя: роль всегда остаётся reader.
 */
export async function guestLogin(req, res) {
  let user = await prisma.user.findUnique({ where: { login: GUEST_LOGIN } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        login: GUEST_LOGIN,
        passwordHash: await bcrypt.hash(randomUUID(), 10),
        role: GUEST_ROLE,
      },
    });
  }

  // Роль служебной записи не должна подняться выше читателя
  if (user.role !== GUEST_ROLE) {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: GUEST_ROLE } });
  }

  console.log(`[auth] guest login ok: ${user.login} (${user.role})`);

  return res.json({ token: signToken(user), user: toPublicUser(user) });
}
