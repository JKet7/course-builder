import 'dotenv/config';
import fs from 'node:fs';
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
const startedAt = new Date();

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

check('GET /blocks без токена -> 401', (await req('/api/blocks?courseId=x')).status === 401);

const courseRes = await req('/api/courses', {
  method: 'POST',
  token,
  body: { title: 'Блоки: смоук', description: 'временный курс' },
});
const course = courseRes.body?.course;
check('POST /courses для блоков -> 201', courseRes.status === 201 && Boolean(course?.id), courseRes);

// ===== создание блоков всех типов =====
const types = ['theory', 'test', 'memo', 'glossary'];
const blocks = [];

for (const [index, type] of types.entries()) {
  const res = await req('/api/blocks', {
    method: 'POST',
    token,
    body: { courseId: course.id, type, title: `Блок ${type}`, description: `Описание ${index}` },
  });
  blocks.push(res.body?.block);
  check(
    `POST /blocks ${type} -> 201, order ${index}`,
    res.status === 201 && res.body?.block?.order === index && res.body?.block?.contentCount === 0,
    { status: res.status, block: res.body?.block },
  );
}

const badType = await req('/api/blocks', {
  method: 'POST',
  token,
  body: { courseId: course.id, type: 'video', title: 'Плохой тип' },
});
check('POST /blocks с типом video -> 400 + errors.type', badType.status === 400 && Boolean(badType.body?.errors?.type), badType);

const badTitle = await req('/api/blocks', {
  method: 'POST',
  token,
  body: { courseId: course.id, type: 'theory', title: '   ' },
});
check('POST /blocks без title -> 400 + errors.title', badTitle.status === 400 && Boolean(badTitle.body?.errors?.title), badTitle);

const badCourse = await req('/api/blocks', {
  method: 'POST',
  token,
  body: { courseId: 'unknown-course', type: 'theory', title: 'Без курса' },
});
check('POST /blocks в неизвестный курс -> 404', badCourse.status === 404, badCourse);

// ===== чтение =====
const list = await req(`/api/blocks?courseId=${course.id}`, { token });
check(
  'GET /blocks?courseId -> 4 блока по порядку',
  list.status === 200 &&
    list.body?.blocks?.length === 4 &&
    list.body.blocks.map((b) => b.type).join(',') === types.join(','),
  list.body?.blocks?.map((b) => ({ type: b.type, order: b.order })),
);

const noCourseId = await req('/api/blocks', { token });
check('GET /blocks без courseId -> 400', noCourseId.status === 400, noCourseId);

const single = await req(`/api/blocks/${blocks[0].id}`, { token });
check('GET /blocks/:id -> 200', single.status === 200 && single.body?.block?.id === blocks[0].id, single.status);

check('GET /blocks/:id неизвестный -> 404', (await req('/api/blocks/does-not-exist', { token })).status === 404);

// ===== обновление =====
const updated = await req(`/api/blocks/${blocks[0].id}`, {
  method: 'PUT',
  token,
  body: { title: 'Блок теории (ред.)', description: 'Новое описание', coverImage: 'https://example.com/cover.png' },
});
check(
  'PUT /blocks/:id -> 200, поля обновлены',
  updated.status === 200 &&
    updated.body?.block?.title === 'Блок теории (ред.)' &&
    updated.body?.block?.coverImage === 'https://example.com/cover.png',
  updated,
);

const clearedCover = await req(`/api/blocks/${blocks[0].id}`, { method: 'PUT', token, body: { coverImage: '' } });
check('PUT /blocks/:id с пустой обложкой -> null', clearedCover.status === 200 && clearedCover.body?.block?.coverImage === null);

const typeChange = await req(`/api/blocks/${blocks[2].id}`, { method: 'PUT', token, body: { type: 'theory' } });
check(
  'PUT /blocks/:id смена типа пустого блока -> 200',
  typeChange.status === 200 && typeChange.body?.block?.type === 'theory',
  typeChange,
);

const emptyUpdate = await req(`/api/blocks/${blocks[0].id}`, { method: 'PUT', token, body: {} });
check('PUT /blocks/:id без полей -> 400', emptyUpdate.status === 400, emptyUpdate);

// тип занятого блока менять нельзя
await prisma.theorySlide.create({ data: { blockId: blocks[0].id, title: 'Слайд', order: 0 } });
const lockedType = await req(`/api/blocks/${blocks[0].id}`, { method: 'PUT', token, body: { type: 'memo' } });
check(
  'PUT /blocks/:id смена типа с контентом -> 400 + errors.type',
  lockedType.status === 400 && Boolean(lockedType.body?.errors?.type),
  lockedType,
);

// ===== порядок =====
const reversed = [...blocks].reverse().map((block) => block.id);
const reorder = await req('/api/blocks/reorder', { method: 'PUT', token, body: { courseId: course.id, orderedIds: reversed } });
check(
  'PUT /blocks/reorder -> обратный порядок',
  reorder.status === 200 && reorder.body?.blocks?.[0]?.id === reversed[0],
  reorder.body?.blocks?.map((b) => b.order),
);

const afterReorder = await req(`/api/blocks?courseId=${course.id}`, { token });
check(
  'порядок сохранён в БД',
  afterReorder.body?.blocks?.map((b) => b.id).join(',') === reversed.join(','),
);

const foreignReorder = await req('/api/blocks/reorder', {
  method: 'PUT',
  token,
  body: { courseId: course.id, orderedIds: ['foreign-id'] },
});
check('PUT /blocks/reorder с чужим id -> 400', foreignReorder.status === 400, foreignReorder);

const incompleteOrder = await req('/api/blocks/reorder', {
  method: 'PUT',
  token,
  body: { courseId: course.id, orderedIds: [reversed[0]] },
});
check(
  'PUT /blocks/reorder с неполным списком -> 400',
  incompleteOrder.status === 400 && Array.isArray(incompleteOrder.body?.missingIds),
  incompleteOrder.body,
);

// ===== удаление =====
const removed = await req(`/api/blocks/${blocks[1].id}`, { method: 'DELETE', token });
check('DELETE /blocks/:id -> 200', removed.status === 200 && removed.body?.ok === true, removed);

const afterDelete = await req(`/api/blocks?courseId=${course.id}`, { token });
check('после удаления осталось 3 блока', afterDelete.body?.blocks?.length === 3, afterDelete.body?.blocks?.length);

check(
  'DELETE /blocks/:id повторно -> 404',
  (await req(`/api/blocks/${blocks[1].id}`, { method: 'DELETE', token })).status === 404,
);

// ===== аудит =====
await new Promise((resolve) => setTimeout(resolve, 300));
const auditRows = await prisma.auditLog.findMany({
  where: { entity: 'Block', createdAt: { gte: startedAt } },
  select: { action: true, entityId: true, userId: true },
});
check(
  'audit: 4 create + 1 delete по блокам',
  auditRows.filter((row) => row.action === 'create').length === 4 &&
    auditRows.filter((row) => row.action === 'delete').length === 1,
  auditRows.map((row) => row.action),
);
check('audit: update записан', auditRows.filter((row) => row.action === 'update').length >= 3, auditRows.length);
check('audit: userId проставлен', auditRows.every((row) => Boolean(row.userId)));

// ===== каскад =====
const cascade = await req(`/api/courses/${course.id}`, { method: 'DELETE', token });
const leftBlocks = await prisma.block.count({ where: { courseId: course.id } });
check('каскад: удаление курса удаляет блоки', cascade.status === 200 && leftBlocks === 0, { status: cascade.status, left: leftBlocks });

check('GET /blocks удалённого курса -> 404', (await req(`/api/blocks?courseId=${course.id}`, { token })).status === 404);

// ===== очистка =====
await prisma.auditLog.deleteMany({ where: { entity: 'Block', createdAt: { gte: startedAt } } });
await prisma.auditLog.deleteMany({ where: { entity: 'Course', createdAt: { gte: startedAt } } });
await prisma.course.deleteMany({ where: { title: 'Блоки: смоук' } });

const out = {
  passed: checks.filter((c) => c.ok).length,
  failed: checks.filter((c) => !c.ok).length,
  checks,
};
fs.writeFileSync('step8-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-blocks: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((c) => !c.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;


