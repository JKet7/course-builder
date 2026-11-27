/**
 * Смоук-тест загрузки картинок (Шаг 10): POST/DELETE /api/files и статика /uploads.
 * Запуск: node scripts/smoke-files.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { MAX_IMAGE_SIZE, UPLOADS_DIR } from '../src/utils/uploads.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(pathName, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(base + pathName, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, contentType: res.headers.get('content-type') };
}

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });
const startedAt = new Date();

// Минимальный PNG 1×1 — достаточно, чтобы проверить mimeType и сохранение на диск.
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const formWith = (buffer, mimeType, filename, field = 'file') => {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type: mimeType }), filename);
  return form;
};

const login = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = login.body?.token;
check('login admin', login.status === 200 && Boolean(token), login.status);

check('POST /files без токена -> 401', (await req('/api/files', { method: 'POST', form: formWith(PNG_PIXEL, 'image/png', 'a.png') })).status === 401);

const noField = await req('/api/files', { method: 'POST', token, form: formWith(PNG_PIXEL, 'image/png', 'a.png', 'upload') });
check('POST /files с неверным полем -> 400', noField.status === 400, noField);

const noFile = await req('/api/files', { method: 'POST', token, form: new FormData() });
check('POST /files без файла -> 400', noFile.status === 400 && /не передан/i.test(noFile.body?.message ?? ''), noFile);

const notImage = await req('/api/files', {
  method: 'POST',
  token,
  form: formWith(Buffer.from('hello'), 'text/plain', 'note.txt'),
});
check('POST /files не картинка -> 400', notImage.status === 400 && /изображения/i.test(notImage.body?.message ?? ''), notImage);

// Лимит мультера общий (как у видео), поэтому картинка > 5 МБ отсекается в контроллере
const tooBigImage = await req('/api/files', {
  method: 'POST',
  token,
  form: formWith(Buffer.alloc(MAX_IMAGE_SIZE + 1), 'image/png', 'big.png'),
});
check(
  'POST /files картинка больше 5 МБ -> 400',
  tooBigImage.status === 400 && /5 МБ/.test(tooBigImage.body?.message ?? ''),
  tooBigImage,
);

const uploaded = await req('/api/files', { method: 'POST', token, form: formWith(PNG_PIXEL, 'image/png', 'pixel.png') });
const file = uploaded.body?.file;
check('POST /files картинка -> 201', uploaded.status === 201 && Boolean(file?.id), uploaded);
check('POST /files: url /uploads/*', typeof file?.url === 'string' && file.url.startsWith('/uploads/'), file);
check('POST /files: mimeType и size', file?.mimeType === 'image/png' && file?.size === PNG_PIXEL.length, file);

const stat = await req(file.url);
check('GET /uploads/<файл> -> 200 image/png', stat.status === 200 && String(stat.contentType).includes('image/png'), stat);

const stored = file?.id ? await prisma.file.findUnique({ where: { id: file.id } }) : null;
check('файл записан в БД с uploadedBy', Boolean(stored?.uploadedBy) && stored?.path === file?.url, stored);

// Видео для фрагмента «Видео»: тот же эндпоинт, лимит 200 МБ, сохраняем с расширением .mp4
const MP4_STUB = Buffer.from('fake-mp4-bytes');
const uploadedVideo = await req('/api/files', { method: 'POST', token, form: formWith(MP4_STUB, 'video/mp4', 'clip.mp4') });
const video = uploadedVideo.body?.file;
check('POST /files видео -> 201', uploadedVideo.status === 201 && Boolean(video?.id), uploadedVideo);
check(
  'POST /files видео: url .mp4, mimeType и size',
  video?.mimeType === 'video/mp4' && /\.mp4$/.test(video?.url ?? '') && video?.size === MP4_STUB.length,
  video,
);

const videoStat = video?.url ? await req(video.url) : { status: 0, contentType: null };
check(
  'GET /uploads/<видео> -> 200 video/mp4',
  videoStat.status === 200 && String(videoStat.contentType).includes('video/mp4'),
  videoStat,
);

const removedVideo = video?.id ? await req(`/api/files/${video.id}`, { method: 'DELETE', token }) : { status: 0 };
check('DELETE /files/:id видео -> 200', removedVideo.status === 200 && removedVideo.body?.ok === true, removedVideo);

// Читателю загрузка запрещена
const readerLogin = 'files-smoke-reader';
await prisma.user.deleteMany({ where: { login: readerLogin } });
await prisma.user.create({
  data: { login: readerLogin, passwordHash: await bcrypt.hash('reader123', 10), role: 'reader' },
});
const readerToken = (await req('/api/auth/login', { method: 'POST', body: { login: readerLogin, password: 'reader123' } })).body?.token;
const forbidden = await req('/api/files', { method: 'POST', token: readerToken, form: formWith(PNG_PIXEL, 'image/png', 'pixel.png') });
check('POST /files читателем -> 403', forbidden.status === 403, forbidden);

const removed = await req(`/api/files/${file?.id}`, { method: 'DELETE', token });
check('DELETE /files/:id -> 200', removed.status === 200 && removed.body?.ok === true, removed);

const afterDelete = await req(file.url);
check('GET удалённого файла -> 404', afterDelete.status === 404, afterDelete.status);
check('запись File удалена', (await prisma.file.findUnique({ where: { id: file.id } })) === null);
check('файл удалён с диска', !fs.existsSync(path.join(UPLOADS_DIR, path.basename(file.url))));

const auditRows = await prisma.auditLog.findMany({ where: { entity: 'File', createdAt: { gte: startedAt } } });
check(
  'audit: File create и delete',
  auditRows.some((row) => row.action === 'create') && auditRows.some((row) => row.action === 'delete'),
  auditRows,
);

// ===== очистка =====
await prisma.auditLog.deleteMany({ where: { entity: 'File', createdAt: { gte: startedAt } } });
await prisma.user.deleteMany({ where: { login: readerLogin } });

const failed = checks.filter((item) => !item.ok);
const outPath = path.join(os.tmpdir(), 'smoke-files-result.json');
fs.writeFileSync(outPath, JSON.stringify({ passed: checks.length - failed.length, total: checks.length, checks }, null, 2), 'utf8');

console.log(`smoke-files: ${checks.length - failed.length}/${checks.length} passed`);
for (const item of failed) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = failed.length ? 1 : 0;
