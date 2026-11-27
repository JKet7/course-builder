import 'dotenv/config';
import fs from 'node:fs';
import app from '../src/app.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const out = {};

out.health = await req('/api/health');

out.loginOk = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = out.loginOk.body?.token ?? null;
out.loginOk.hasToken = Boolean(token);
delete out.loginOk.body;

out.loginWrongPassword = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'nope' } });
out.loginUnknownUser = await req('/api/auth/login', { method: 'POST', body: { login: 'ghost', password: 'nope' } });
out.loginInvalidBody = await req('/api/auth/login', { method: 'POST', body: { login: 'a' } });
out.loginNotObject = await req('/api/auth/login', { method: 'POST', body: ['admin', 'admin123'] });

// Вход «как читатель»: без логина и пароля, роль reader
out.guestLogin = await req('/api/auth/guest', { method: 'POST' });
out.guestLogin.hasToken = Boolean(out.guestLogin.body?.token);
out.guestLogin.role = out.guestLogin.body?.user?.role;
const guestToken = out.guestLogin.body?.token ?? null;
delete out.guestLogin.body;

out.guestMe = await req('/api/auth/me', { token: guestToken });
out.guestCreateCourse = await req('/api/courses', { method: 'POST', token: guestToken, body: { title: 'Нельзя' } });

out.meWithoutToken = await req('/api/auth/me');
out.meWithBadToken = await req('/api/auth/me', { token: 'abc.def.ghi' });
out.meWithToken = await req('/api/auth/me', { token });

out.unknownRoute = await req('/api/nope');

fs.writeFileSync('step3-result.json', JSON.stringify(out, null, 2), 'utf8');
server.close();
