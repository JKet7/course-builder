/**
 * Смоук-тест API слайдов и контента теории (Шаг 9).
 * Запуск: node scripts/smoke-slides.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(pathName, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + pathName, {
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

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Привет' }] }] };

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

check('GET /slides без токена -> 401', (await req('/api/slides?blockId=x')).status === 401);
check('GET /contents без токена -> 401', (await req('/api/contents?slideId=x')).status === 401);

// Хвосты предыдущих неудачных прогонов (курс создаётся заново)
await prisma.course.deleteMany({ where: { title: 'Слайды: смоук' } });

const courseRes = await req('/api/courses', {
  method: 'POST',
  token,
  body: { title: 'Слайды: смоук', description: 'временный курс шага 9' },
});
const course = courseRes.body?.course;
check('POST /courses -> 201', courseRes.status === 201 && Boolean(course?.id), courseRes);

const theoryRes = await req('/api/blocks', {
  method: 'POST',
  token,
  body: { courseId: course.id, type: 'theory', title: 'Теория: смоук' },
});
const theory = theoryRes.body?.block;
check('POST /blocks theory -> 201', theoryRes.status === 201 && theory?.type === 'theory', theoryRes);

const testRes = await req('/api/blocks', {
  method: 'POST',
  token,
  body: { courseId: course.id, type: 'test', title: 'Тест: смоук' },
});
const testBlock = testRes.body?.block;

// ===== валидация списка слайдов =====
check('GET /slides без blockId -> 400', (await req('/api/slides', { token })).status === 400);
check('GET /slides неизвестного блока -> 404', (await req(`/api/slides?blockId=unknown`, { token })).status === 404);

const slidesOnTest = await req(`/api/slides?blockId=${testBlock.id}`, { token });
check('GET /slides блока «Тест» -> 400', slidesOnTest.status === 400, slidesOnTest);

const slideOnTest = await req('/api/slides', {
  method: 'POST',
  token,
  body: { blockId: testBlock.id, title: 'Нельзя' },
});
check('POST /slides в блок «Тест» -> 400', slideOnTest.status === 400, slideOnTest);

// ===== создание слайдов =====
const slides = [];
for (const [index, title] of ['Введение', 'Основы', 'Итоги'].entries()) {
  const res = await req('/api/slides', { method: 'POST', token, body: { blockId: theory.id, title } });
  slides.push(res.body?.slide);
  check(
    `POST /slides «${title}» -> 201, order ${index}, пустой`,
    res.status === 201 && res.body?.slide?.order === index && res.body?.slide?.contentCount === 0,
    { status: res.status, slide: res.body?.slide },
  );
}

const untitled = await req('/api/slides', { method: 'POST', token, body: { blockId: theory.id } });
check('POST /slides без title -> null', untitled.status === 201 && untitled.body?.slide?.title === null, untitled.body?.slide);
await req(`/api/slides/${untitled.body.slide.id}`, { method: 'DELETE', token });

const slideList = await req(`/api/slides?blockId=${theory.id}`, { token });
check(
  'GET /slides -> 3 слайда по порядку',
  slideList.status === 200 &&
    slideList.body?.slides?.length === 3 &&
    slideList.body.slides.map((slide) => slide.title).join(',') === 'Введение,Основы,Итоги',
  slideList.body?.slides?.map((slide) => ({ title: slide.title, order: slide.order })),
);
check('GET /slides отдаёт contents и contentCount', Array.isArray(slideList.body?.slides?.[0]?.contents) && slideList.body.slides[0].contentCount === 0);

// ===== чтение и переименование слайда =====
const renamed = await req(`/api/slides/${slides[0].id}`, { method: 'PUT', token, body: { title: '  Введение  ' } });
check('PUT /slides/:id обрезает пробелы', renamed.status === 200 && renamed.body?.slide?.title === 'Введение', renamed.body?.slide);

const cleared = await req(`/api/slides/${slides[0].id}`, { method: 'PUT', token, body: { title: '' } });
check('PUT /slides/:id пустой title -> null', cleared.status === 200 && cleared.body?.slide?.title === null, cleared.body?.slide);
await req(`/api/slides/${slides[0].id}`, { method: 'PUT', token, body: { title: 'Введение' } });

check(
  'PUT /slides/:id без полей -> 400',
  (await req(`/api/slides/${slides[0].id}`, { method: 'PUT', token, body: {} })).status === 400,
);
check(
  'GET /slides/:id -> слайд с блоком',
  (await req(`/api/slides/${slides[0].id}`, { token })).body?.slide?.block?.type === 'theory',
);
check(
  'GET /slides/:id неизвестного -> 404',
  (await req('/api/slides/unknown-slide', { token })).status === 404,
);

const slideId = slides[0].id;

// ===== валидация контента =====
check('GET /contents без slideId -> 400', (await req('/api/contents', { token })).status === 400);
check(
  'GET /contents неизвестного слайда -> 404',
  (await req('/api/contents?slideId=unknown', { token })).status === 404,
);

const badType = await req('/api/contents', { method: 'POST', token, body: { slideId, type: 'video-player' } });
check('POST /contents с плохим типом -> 400 + errors.type', badType.status === 400 && Boolean(badType.body?.errors?.type), badType);

const clientVersion = await req('/api/contents', {
  method: 'POST',
  token,
  body: { slideId, type: 'text', data: emptyDoc, dataVersion: 9 },
});
check('POST /contents с dataVersion от клиента -> 400', clientVersion.status === 400, clientVersion);

const badWidth = await req('/api/contents', { method: 'POST', token, body: { slideId, type: 'text', width: 40 } });
check('POST /contents с width 40 -> 400 + errors.width', badWidth.status === 400 && Boolean(badWidth.body?.errors?.width), badWidth);

const badDoc = await req('/api/contents', {
  method: 'POST',
  token,
  body: { slideId, type: 'text', data: { html: '<p>x</p>' } },
});
check('POST /contents «text» без Tiptap-документа -> 400 + errors.data', badDoc.status === 400 && Boolean(badDoc.body?.errors?.data), badDoc);

// ===== создание контента =====
const textContent = await req('/api/contents', { method: 'POST', token, body: { slideId, type: 'text' } });
const content = textContent.body?.content;
check(
  'POST /contents «text» без data -> пустой документ, dataVersion 1, width 100',
  textContent.status === 201 &&
    content?.dataVersion === 1 &&
    content?.width === 100 &&
    content?.data?.type === 'doc' &&
    content?.order === 0,
  textContent.body?.content,
);

const imageContent = await req('/api/contents', {
  method: 'POST',
  token,
  body: { slideId, type: 'image', width: 50 },
});
check(
  'POST /contents «image» -> дефолтные поля и width 50',
  imageContent.status === 201 && imageContent.body?.content?.width === 50 && imageContent.body?.content?.data?.align === 'center',
  imageContent.body?.content,
);

const importantContent = await req('/api/contents', {
  method: 'POST',
  token,
  body: { slideId, type: 'important', data: emptyDoc, width: 50 },
});
check('POST /contents «important» с документом -> 201', importantContent.status === 201, importantContent.body);

const contentsList = await req(`/api/contents?slideId=${slideId}`, { token });
check(
  'GET /contents -> 3 фрагмента по order + dataVersion',
  contentsList.status === 200 &&
    contentsList.body?.contents?.length === 3 &&
    contentsList.body?.dataVersion === 1 &&
    contentsList.body.contents.map((item) => item.type).join(',') === 'text,image,important',
  { dataVersion: contentsList.body?.dataVersion, types: contentsList.body?.contents?.map((item) => item.type) },
);

const slidesAfter = await req(`/api/slides?blockId=${theory.id}`, { token });
check('счётчик слайда обновился -> 3 фрагмента', slidesAfter.body?.slides?.[0]?.contentCount === 3, slidesAfter.body?.slides?.[0]?.contentCount);

// Видео: ширина колонки — как у остальных фрагментов, положение на слайде — data.align
const videoContent = await req('/api/contents', {
  method: 'POST',
  token,
  body: { slideId, type: 'video', width: 50, data: { url: 'https://youtu.be/abc123', align: 'right' } },
});
check(
  'POST /contents «video» -> width 50 и align right',
  videoContent.status === 201 &&
    videoContent.body?.content?.width === 50 &&
    videoContent.body?.content?.data?.align === 'right',
  videoContent.body?.content,
);

const videoFallback = await req(`/api/contents/${videoContent.body?.content?.id}`, {
  method: 'PUT',
  token,
  body: { data: { align: 'top' } },
});
check(
  'PUT /contents «video»: неизвестное выравнивание -> center',
  videoFallback.status === 200 && videoFallback.body?.content?.data?.align === 'center',
  videoFallback.body?.content?.data,
);

// Убираем временный фрагмент, чтобы счётчики ниже остались прежними
if (videoContent.body?.content?.id) {
  await req(`/api/contents/${videoContent.body.content.id}`, { method: 'DELETE', token });
}

// ===== обновление контента =====
const updatedText = await req(`/api/contents/${content.id}`, {
  method: 'PUT',
  token,
  body: { data: emptyDoc },
});
check('PUT /contents/:id сохраняет Tiptap-документ', updatedText.status === 200 && updatedText.body?.content?.data?.content?.length === 1, updatedText.body?.content?.data);

const updatedWidth = await req(`/api/contents/${content.id}`, { method: 'PUT', token, body: { width: 33 } });
check('PUT /contents/:id width 33 -> 200', updatedWidth.status === 200 && updatedWidth.body?.content?.width === 33, updatedWidth.body?.content?.width);

check(
  'PUT /contents/:id width 45 -> 400',
  (await req(`/api/contents/${content.id}`, { method: 'PUT', token, body: { width: 45 } })).status === 400,
);
check(
  'PUT /contents/:id dataVersion -> 400',
  (await req(`/api/contents/${content.id}`, { method: 'PUT', token, body: { dataVersion: 2 } })).status === 400,
);
check(
  'PUT /contents/:id без полей -> 400',
  (await req(`/api/contents/${content.id}`, { method: 'PUT', token, body: {} })).status === 400,
);

const mergedImage = await req(`/api/contents/${imageContent.body.content.id}`, {
  method: 'PUT',
  token,
  body: { data: { caption: 'Схема' } },
});
check(
  'PUT /contents «image» мержит data (align сохранился)',
  mergedImage.status === 200 && mergedImage.body?.content?.data?.caption === 'Схема' && mergedImage.body?.content?.data?.align === 'center',
  mergedImage.body?.content?.data,
);

check(
  'GET /contents/:id неизвестного -> 404',
  (await req('/api/contents/unknown-content', { token })).status === 404,
);

// ===== порядок контента =====
const contentIds = contentsList.body.contents.map((item) => item.id);
const reversedContents = [...contentIds].reverse();
const reordered = await req('/api/contents/reorder', {
  method: 'PUT',
  token,
  body: { slideId, orderedIds: reversedContents },
});
check(
  'PUT /contents/reorder -> обратный порядок',
  reordered.status === 200 && reordered.body?.contents?.map((item) => item.id).join(',') === reversedContents.join(','),
  reordered.body?.contents?.map((item) => item.order),
);

check(
  'PUT /contents/reorder с чужим id -> 400',
  (await req('/api/contents/reorder', { method: 'PUT', token, body: { slideId, orderedIds: ['foreign-id'] } })).status === 400,
);

check(
  'PUT /contents/reorder с дубликатом -> 400',
  (
    await req('/api/contents/reorder', {
      method: 'PUT',
      token,
      body: { slideId, orderedIds: [...reversedContents, reversedContents[0]] },
    })
  ).status === 400,
);

// ===== порядок слайдов =====
const slideIds = slides.map((slide) => slide.id);
const reversedSlides = [...slideIds].reverse();
const slideReorder = await req('/api/slides/reorder', {
  method: 'PUT',
  token,
  body: { blockId: theory.id, orderedIds: reversedSlides },
});
check(
  'PUT /slides/reorder -> обратный порядок',
  slideReorder.status === 200 && slideReorder.body?.slides?.map((slide) => slide.id).join(',') === reversedSlides.join(','),
  slideReorder.body?.slides?.map((slide) => slide.title),
);

check(
  'PUT /slides/reorder с чужим id -> 400',
  (await req('/api/slides/reorder', { method: 'PUT', token, body: { blockId: theory.id, orderedIds: ['foreign-id'] } })).status === 400,
);

// ===== удаление =====
const removedContent = await req(`/api/contents/${content.id}`, { method: 'DELETE', token });
check('DELETE /contents/:id -> 200', removedContent.status === 200 && removedContent.body?.ok === true, removedContent.status);
check(
  'DELETE /contents/:id повторно -> 404',
  (await req(`/api/contents/${content.id}`, { method: 'DELETE', token })).status === 404,
);

const removedSlide = await req(`/api/slides/${slideId}`, { method: 'DELETE', token });
const leftContents = await prisma.theoryContent.count({ where: { slideId } });
check('DELETE /slides/:id -> 200 и контент удалён каскадом', removedSlide.status === 200 && leftContents === 0, { status: removedSlide.status, leftContents });
check(
  'DELETE /slides/:id повторно -> 404',
  (await req(`/api/slides/${slideId}`, { method: 'DELETE', token })).status === 404,
);

// ===== аудит =====
await new Promise((resolve) => setTimeout(resolve, 300));
const auditRows = await prisma.auditLog.findMany({
  where: { entity: { in: ['Slide', 'Content'] }, createdAt: { gte: startedAt } },
  select: { action: true, entity: true, userId: true },
});
check(
  'audit: слайды — 4 create (3 + без названия) и 2 delete',
  auditRows.filter((row) => row.entity === 'Slide' && row.action === 'create').length === 4 &&
    auditRows.filter((row) => row.entity === 'Slide' && row.action === 'delete').length === 2,
  auditRows.filter((row) => row.entity === 'Slide'),
);
check(
  'audit: контент — 4 create (3 + видео) и 2 delete',
  auditRows.filter((row) => row.entity === 'Content' && row.action === 'create').length === 4 &&
    auditRows.filter((row) => row.entity === 'Content' && row.action === 'delete').length === 2,
  auditRows.filter((row) => row.entity === 'Content'),
);
check('audit: userId проставлен', auditRows.every((row) => Boolean(row.userId)));

// ===== каскад курса =====
const cascade = await req(`/api/courses/${course.id}`, { method: 'DELETE', token });
const leftSlides = await prisma.theorySlide.count({ where: { blockId: theory.id } });
const leftAllContents = await prisma.theoryContent.count({ where: { slide: { blockId: theory.id } } });
check(
  'каскад: удаление курса удаляет слайды и контент',
  cascade.status === 200 && leftSlides === 0 && leftAllContents === 0,
  { status: cascade.status, leftSlides, leftAllContents },
);

// ===== очистка =====
await prisma.auditLog.deleteMany({ where: { entity: { in: ['Slide', 'Content', 'Block'] }, createdAt: { gte: startedAt } } });
await prisma.auditLog.deleteMany({ where: { entity: 'Course', createdAt: { gte: startedAt } } });
await prisma.course.deleteMany({ where: { title: 'Слайды: смоук' } });

const failed = checks.filter((item) => !item.ok);
const outPath = path.join(os.tmpdir(), 'smoke-slides-result.json');
fs.writeFileSync(outPath, JSON.stringify({ passed: checks.length - failed.length, total: checks.length, checks }, null, 2), 'utf8');

console.log(`smoke-slides: ${checks.length - failed.length}/${checks.length} passed`);
for (const item of failed) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = failed.length ? 1 : 0;




