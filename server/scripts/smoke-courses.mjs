import 'dotenv/config';
import fs from 'node:fs';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';

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

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });

const READER_LOGIN = 'smoke_reader';
const readerHash = await bcrypt.hash('reader123', 10);
await prisma.user.upsert({
  where: { login: READER_LOGIN },
  update: { passwordHash: readerHash, role: 'reader' },
  create: { login: READER_LOGIN, passwordHash: readerHash, role: 'reader' },
});

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const adminToken = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(adminToken), admin.status);

const reader = await req('/api/auth/login', { method: 'POST', body: { login: READER_LOGIN, password: 'reader123' } });
const readerToken = reader.body?.token;
check('login reader', reader.status === 200 && Boolean(readerToken), reader.status);

check('GET /courses without token -> 401', (await req('/api/courses')).status === 401);

const forbidden = await req('/api/courses', { method: 'POST', token: readerToken, body: { title: 'Нельзя' } });
check('POST /courses as reader -> 403', forbidden.status === 403, forbidden);

const createdA = await req('/api/courses', { method: 'POST', token: adminToken, body: { title: 'Курс A', description: 'Описание A' } });
const courseA = createdA.body?.course;
check('POST course A -> 201, order 0', createdA.status === 201 && courseA?.order === 0, createdA);

const createdB = await req('/api/courses', { method: 'POST', token: adminToken, body: { title: 'Курс B' } });
const courseB = createdB.body?.course;
check('POST course B -> 201, order 1', createdB.status === 201 && courseB?.order === 1, createdB);

const invalidCreate = await req('/api/courses', { method: 'POST', token: adminToken, body: {} });
check('POST course without title -> 400', invalidCreate.status === 400, invalidCreate);

const list = await req('/api/courses', { token: adminToken });
check(
  'GET /courses -> 200, содержит созданные',
  list.status === 200 && list.body?.courses?.some((c) => c.id === courseA.id) && list.body?.courses?.every((c) => typeof c.blocksCount === 'number'),
  list.body?.courses?.map((c) => ({ title: c.title, order: c.order, blocksCount: c.blocksCount })),
);

const one = await req(`/api/courses/${courseA.id}`, { token: adminToken });
check('GET /courses/:id -> 200 + blocks []', one.status === 200 && Array.isArray(one.body?.course?.blocks) && one.body.course.blocks.length === 0, one);

check('GET /courses/:id unknown -> 404', (await req('/api/courses/does-not-exist', { token: adminToken })).status === 404);

const updated = await req(`/api/courses/${courseA.id}`, { method: 'PUT', token: adminToken, body: { title: 'Курс A (ред.)' } });
check('PUT /courses/:id -> 200, новый title', updated.status === 200 && updated.body?.course?.title === 'Курс A (ред.)', updated);

const emptyUpdate = await req(`/api/courses/${courseA.id}`, { method: 'PUT', token: adminToken, body: {} });
check('PUT /courses/:id без полей -> 400', emptyUpdate.status === 400, emptyUpdate);

const reorder = await req('/api/courses/reorder', { method: 'PUT', token: adminToken, body: { orderedIds: [courseB.id, courseA.id] } });
check(
  'PUT /courses/reorder -> порядок B, A',
  reorder.status === 200 && reorder.body?.courses?.[0]?.id === courseB.id && reorder.body?.courses?.[1]?.id === courseA.id,
  reorder.body?.courses?.map((c) => ({ title: c.title, order: c.order })),
);

const badReorder = await req('/api/courses/reorder', { method: 'PUT', token: adminToken, body: { orderedIds: ['unknown-id'] } });
check('PUT /courses/reorder с чужим id -> 400', badReorder.status === 400, badReorder);

const emptyReorder = await req('/api/courses/reorder', { method: 'PUT', token: adminToken, body: { orderedIds: [] } });
check('PUT /courses/reorder c пустым массивом -> 400', emptyReorder.status === 400, emptyReorder);

const duplicateOrder = await req('/api/courses/reorder', {
  method: 'PUT',
  token: adminToken,
  body: { orderedIds: [courseB.id, courseA.id, courseA.id] },
});
check('PUT /courses/reorder с дубликатом -> 400', duplicateOrder.status === 400, duplicateOrder.body);

const incompleteOrder = await req('/api/courses/reorder', { method: 'PUT', token: adminToken, body: { orderedIds: [courseB.id] } });
check(
  'PUT /courses/reorder с неполным списком -> 400 + missingIds',
  incompleteOrder.status === 400 && incompleteOrder.body?.missingIds?.includes(courseA.id),
  incompleteOrder.body,
);

const deleted = await req(`/api/courses/${courseA.id}`, { method: 'DELETE', token: adminToken });
check('DELETE /courses/:id -> 200', deleted.status === 200 && deleted.body?.ok === true, deleted);

check('DELETE /courses/:id повторно -> 404', (await req(`/api/courses/${courseA.id}`, { method: 'DELETE', token: adminToken })).status === 404);

// каскад: удаление курса удаляет его блоки (проверяем на курсе B)
const block = await prisma.block.create({
  data: { courseId: courseB.id, type: 'theory', title: 'Временный блок', order: 0 },
});
await prisma.course.delete({ where: { id: courseB.id } });
const orphanBlocks = await prisma.block.count({ where: { id: block.id } });
check('каскад: удаление курса удаляет блоки', orphanBlocks === 0, { blockId: block.id, left: orphanBlocks });

// ===== аудит =====
await new Promise((resolve) => setTimeout(resolve, 300));
const auditRows = await prisma.auditLog.findMany({
  where: { entity: 'Course' },
  orderBy: { createdAt: 'asc' },
  select: { action: true, entity: true, entityId: true, userId: true },
});
const actions = auditRows.map((row) => row.action);
check(
  'audit: create x2, update x2, delete x1 (403/404 не логируются)',
  actions.filter((a) => a === 'create').length === 2 &&
    actions.filter((a) => a === 'update').length === 2 &&
    actions.filter((a) => a === 'delete').length === 1 &&
    auditRows.length === 5,
  auditRows,
);
check('audit: userId проставлен', auditRows.every((row) => Boolean(row.userId)), auditRows.length);
check(
  'audit: 404 не логируются',
  auditRows.every((row) => row.entityId !== 'does-not-exist'),
  auditRows.map((row) => row.entityId),
);

// ===== очистка =====
await prisma.auditLog.deleteMany({ where: { entity: 'Course' } });
await prisma.course.deleteMany({ where: { title: { in: ['Курс A', 'Курс A (ред.)', 'Курс B', 'Нельзя'] } } });
await prisma.user.deleteMany({ where: { login: READER_LOGIN } });

const out = {
  passed: checks.filter((c) => c.ok).length,
  failed: checks.filter((c) => !c.ok).length,
  checks,
};
fs.writeFileSync('step4-result.json', JSON.stringify(out, null, 2), 'utf8');

server.close();
await prisma.$disconnect();
