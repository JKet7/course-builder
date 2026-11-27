import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const clientRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverRoot = path.join(path.dirname(clientRoot), 'server');
const API_URL = 'http://127.0.0.1:4000';

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Поднимаем backend
const backend = spawn(process.execPath, ['src/index.js'], { cwd: serverRoot, stdio: 'ignore' });

let backendReady = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    if (res.ok) {
      backendReady = true;
      break;
    }
  } catch {
    // ещё не поднялся
  }
  await sleep(300);
}
check('backend запущен на :4000', backendReady);

// 2. Поднимаем Vite dev-сервер программно (с конфигом проекта → proxy работает)
const vite = await createServer({ root: clientRoot, server: { port: 5174, strictPort: true } });
await vite.listen();
const base = (vite.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
check('vite dev-сервер запущен', Boolean(base), base);

try {
  // 3. SPA-страница
  const loginPage = await fetch(`${base}/login`);
  const loginHtml = await loginPage.text();
  check('GET /login -> 200 + <div id="root">', loginPage.status === 200 && loginHtml.includes('id="root"'), loginPage.status);

  // 4. history-fallback для вложенного маршрута
  const deepLink = await fetch(`${base}/course/some-id`);
  check('GET /course/:id -> 200 (SPA fallback)', deepLink.status === 200, deepLink.status);

  // 5. Проксирование /api на backend
  const health = await fetch(`${base}/api/health`);
  const healthBody = await health.json();
  check('proxy /api/health -> 200 ok', health.status === 200 && healthBody.status === 'ok', healthBody);

  // 6. Логин через прокси
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  });
  const loginBody = await loginRes.json();
  const token = loginBody.token;
  check('proxy POST /api/auth/login -> токен', loginRes.status === 200 && Boolean(token), {
    status: loginRes.status,
    tokenLength: token?.length ?? 0,
    role: loginBody.user?.role,
  });

  // 6b. Вход «как читатель» через прокси (кнопка на странице входа)
  const guestRes = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
  const guestBody = await guestRes.json();
  check('proxy POST /api/auth/guest -> роль reader', guestRes.status === 200 && guestBody.user?.role === 'reader', {
    status: guestRes.status,
    role: guestBody.user?.role,
  });

  // 7. Защищённый роут курсов через прокси
  const coursesRes = await fetch(`${base}/api/courses`, { headers: { Authorization: `Bearer ${token}` } });
  const coursesBody = await coursesRes.json();
  check('proxy GET /api/courses -> 200 массив', coursesRes.status === 200 && Array.isArray(coursesBody.courses), {
    status: coursesRes.status,
    count: coursesBody.courses?.length,
  });

  const unauthorized = await fetch(`${base}/api/courses`);
  check('proxy GET /api/courses без токена -> 401', unauthorized.status === 401, unauthorized.status);
} finally {
  await vite.close();
  backend.kill();
}

// 8. API недоступен: прокси отвечает 503 с Retry-After и понятным сообщением,
//    а не 502 Bad Gateway от шлюза. Направляем прокси на заведомо мёртвый порт
//    и ждём, пока остановится настоящий backend.
process.env.API_PROXY_TARGET = 'http://127.0.0.1:4099';
for (let attempt = 0; attempt < 20; attempt += 1) {
  const alive = await fetch(`${API_URL}/api/health`).then(
    () => true,
    () => false,
  );
  if (!alive) break;
  await sleep(150);
}

const downVite = await createServer({
  root: clientRoot,
  logLevel: 'error',
  server: { port: 5175, strictPort: true },
});
await downVite.listen();

try {
  const downBase = (downVite.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5175/').replace(/\/$/, '');
  const downRes = await fetch(`${downBase}/api/health`);
  const downBody = await downRes.json().catch(() => ({}));
  check(
    'proxy без API -> 503 + Retry-After вместо 502',
    downRes.status === 503 &&
      downRes.headers.get('retry-after') === '2' &&
      /временно недоступен/i.test(downBody.message ?? ''),
    { status: downRes.status, retryAfter: downRes.headers.get('retry-after'), body: downBody },
  );

  // Картинки проксируются тем же Express: /uploads не должен отдавать 502.
  const uploadRes = await fetch(`${downBase}/uploads/missing.png`);
  check('proxy /uploads без API -> 503, а не 502', uploadRes.status === 503, uploadRes.status);
} finally {
  await downVite.close();
}

const out = { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks };
fs.writeFileSync(path.join(clientRoot, 'step5-live.json'), JSON.stringify(out, null, 2), 'utf8');
process.exit(out.failed === 0 ? 0 : 1);
