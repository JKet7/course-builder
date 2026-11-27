import jwt from 'jsonwebtoken';

const FALLBACK_SECRET = 'dev-only-secret-change-me';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('[auth] JWT_SECRET не задан, используется dev-секрет');
    return FALLBACK_SECRET;
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, login: user.login, role: user.role },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
