/**
 * Смоук Шага 15: данные для печати курса (GET /api/courses/:id/print).
 * Запуск (из папки server): node scripts/smoke-step15.mjs
 *
 * Проверяется: доступ (401 без токена, читателю можно), 404, полный набор
 * блоков и их содержимого, порядок массивов (order → позиция), «алфавит»
 * глоссария, изоляция курсов, пустой курс, свежесть ответа (без кеша),
 * отсутствие записи в аудите и очистка песочницы.
 */
import 'dotenv/config';
import fs from 'node:fs';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { signToken } from '../src/utils/jwt.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(pathname, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(base + pathname, {
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

  return { status: res.status, body: json, headers: res.headers };
}

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = new Date();
const TEST_PREFIX = 'Шаг 15:';

const textDoc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

// ===== чистая песочница =====
await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step15-' } } });

const reader = await prisma.user.create({
  data: { login: 'step15-reader', passwordHash: 'not-used', role: 'reader' },
});
const readerToken = signToken(reader);

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

// ===== курс со всеми типами блоков =====
const course = await prisma.course.create({
  data: {
    title: `${TEST_PREFIX} печать`,
    description: 'Документ для проверки печати',
    order: 1000,
  },
});

// Порядок создания намеренно перемешан: ответ должен идти по order, а не по createdAt.
const glossary = await prisma.block.create({
  data: { courseId: course.id, type: 'glossary', title: 'Глоссарий', order: 3 },
});

const memo = await prisma.block.create({
  data: { courseId: course.id, type: 'memo', title: 'Памятка', order: 2 },
});

const testBlock = await prisma.block.create({
  data: { courseId: course.id, type: 'test', title: 'Тест', description: 'Вопросы печати', order: 1 },
});

const theory = await prisma.block.create({
  data: {
    courseId: course.id,
    type: 'theory',
    title: 'Теория',
    coverImage: '/uploads/step15-cover.png',
    order: 0,
  },
});

// Слайды: второй создаём первым, чтобы проверить сортировку.
const slideTwo = await prisma.theorySlide.create({
  data: { blockId: theory.id, title: 'Слайд 2', order: 1 },
});

const slideOne = await prisma.theorySlide.create({
  data: { blockId: theory.id, title: 'Слайд 1', order: 0 },
});

await prisma.theoryContent.create({
  data: {
    slideId: slideTwo.id,
    type: 'checklist',
    data: { title: 'Чек-лист печати', columns: 1, items: [{ id: '1', text: 'Пункт', checked: true }] },
    order: 0,
  },
});

await prisma.theoryContent.createMany({
  data: [
    {
      slideId: slideOne.id,
      type: 'image',
      data: { fileId: null, url: 'https://example.com/step15.png', alt: 'Схема', caption: 'Рисунок', width: 100, align: 'center' },
      width: 50,
      order: 1,
    },
    { slideId: slideOne.id, type: 'text', data: textDoc('Текст слайда'), width: 50, order: 0 },
  ],
});

const group = await prisma.testGroup.create({
  data: { blockId: testBlock.id, name: 'Группа печати', order: 0 },
});

const cardQuestion = await prisma.testQuestion.create({
  data: { blockId: testBlock.id, type: 'card', data: { front: 'Вопрос', back: 'Ответ' }, order: 2 },
});

const matchQuestion = await prisma.testQuestion.create({
  data: { blockId: testBlock.id, type: 'match', data: { text: 'Сопоставьте' }, order: 1 },
});

await prisma.testPair.createMany({
  data: [
    { questionId: matchQuestion.id, left: 'b', right: '2', order: 1 },
    { questionId: matchQuestion.id, left: 'a', right: '1', order: 0 },
  ],
});

const singleQuestion = await prisma.testQuestion.create({
  data: {
    blockId: testBlock.id,
    groupId: group.id,
    type: 'single',
    data: { text: 'Сколько будет 2 + 2?' },
    explanation: textDoc('Потому что четыре'),
    order: 0,
  },
});

await prisma.testOption.createMany({
  data: [
    { questionId: singleQuestion.id, text: '5', isCorrect: false, order: 1 },
    { questionId: singleQuestion.id, text: '4', isCorrect: true, order: 0 },
  ],
});

const memoSlideOne = await prisma.memoSlide.create({
  data: { blockId: memo.id, title: 'Слайд 1', order: 0 },
});

const memoSlideTwo = await prisma.memoSlide.create({
  data: { blockId: memo.id, title: 'Слайд 2', order: 1 },
});

await prisma.memoCell.createMany({
  data: [
    { blockId: memo.id, slideId: memoSlideOne.id, title: 'Карточка 2', body: textDoc('Второй текст'), order: 1 },
    { blockId: memo.id, slideId: memoSlideOne.id, title: 'Карточка 1', body: textDoc('Первый текст'), order: 0 },
    { blockId: memo.id, slideId: memoSlideTwo.id, title: 'Карточка 3', body: textDoc('Третий текст'), order: 0 },
  ],
});

await prisma.glossaryTerm.createMany({
  data: [
    { blockId: glossary.id, term: 'Яблоко', definition: textDoc('Фрукт') },
    { blockId: glossary.id, term: 'Абрикос', definition: textDoc('Тоже фрукт') },
  ],
});

// Курс-сосед: его блок не должен попасть в документ первого курса.
const otherCourse = await prisma.course.create({
  data: { title: `${TEST_PREFIX} другой`, order: 1001 },
});

const otherBlock = await prisma.block.create({
  data: { courseId: otherCourse.id, type: 'memo', title: 'Чужая памятка', order: 0 },
});

const otherSlide = await prisma.memoSlide.create({
  data: { blockId: otherBlock.id, title: 'Слайд 1', order: 0 },
});

await prisma.memoCell.create({
  data: { blockId: otherBlock.id, slideId: otherSlide.id, title: 'Чужая карточка', body: textDoc('Не печатать'), order: 0 },
});

const emptyCourse = await prisma.course.create({
  data: { title: `${TEST_PREFIX} пустой`, order: 1002 },
});

// ===== доступ =====
const noToken = await req(`/api/courses/${course.id}/print`);
check('без токена: 401', noToken.status === 401, noToken.status);

const unknown = await req('/api/courses/no-such-course/print', { token });
check('неизвестный курс: 404', unknown.status === 404, unknown.status);

const asReader = await req(`/api/courses/${course.id}/print`, { token: readerToken });
check('читатель может печатать: 200', asReader.status === 200, asReader.status);

const print = await req(`/api/courses/${course.id}/print`, { token });
check('GET print: 200', print.status === 200, print.status);
check(
  'GET print: Content-Type JSON',
  String(print.headers.get('content-type') ?? '').includes('application/json'),
  print.headers.get('content-type'),
);
check('GET print: Cache-Control no-store', print.headers.get('cache-control') === 'no-store', print.headers.get('cache-control'));

const doc = print.body?.course;
check(
  'курс: название и описание',
  doc?.title === `${TEST_PREFIX} печать` && doc?.description === 'Документ для проверки печати',
  { title: doc?.title, description: doc?.description },
);
check('курс: дата обновления ISO', typeof doc?.updatedAt === 'string' && !Number.isNaN(Date.parse(doc.updatedAt)), doc?.updatedAt);
check(
  'документ: отметка формирования',
  typeof print.body?.generatedAt === 'string' && !Number.isNaN(Date.parse(print.body.generatedAt)),
  print.body?.generatedAt,
);

const blocks = doc?.blocks ?? [];
check(
  'блоки: четыре в порядке order',
  blocks.map((block) => block.type).join(',') === 'theory,test,memo,glossary',
  blocks.map((block) => block.type),
);
check(
  'блоки: id и заголовки на месте',
  blocks.map((block) => block.id).join(',') === [theory.id, testBlock.id, memo.id, glossary.id].join(',') &&
    blocks[0]?.title === 'Теория',
  blocks.map((block) => block.id),
);

// ===== теория =====
const theoryDoc = blocks[0];
check(
  'теория: обложка и слайды по порядку',
  theoryDoc?.coverImage === '/uploads/step15-cover.png' &&
    theoryDoc.slides.map((slide) => slide.title).join(',') === 'Слайд 1,Слайд 2',
  { cover: theoryDoc?.coverImage, slides: theoryDoc?.slides?.map((slide) => slide.title) },
);
check(
  'теория: контент слайда по порядку',
  theoryDoc?.slides?.[0]?.contents?.map((content) => content.type).join(',') === 'text,image',
  theoryDoc?.slides?.[0]?.contents?.map((content) => content.type),
);
check(
  'теория: данные картинки и ширина колонки',
  theoryDoc?.slides?.[0]?.contents?.[1]?.data?.url === 'https://example.com/step15.png' &&
    theoryDoc.slides[0].contents[1].width === 50 &&
    Number.isInteger(theoryDoc.slides[0].contents[0].dataVersion),
  theoryDoc?.slides?.[0]?.contents?.map((content) => ({ width: content.width, url: content.data?.url, v: content.dataVersion })),
);
check(
  'теория: второй слайд с чек-листом',
  theoryDoc?.slides?.[1]?.contents?.[0]?.type === 'checklist' &&
    theoryDoc.slides[1].contents[0].data?.title === 'Чек-лист печати',
  theoryDoc?.slides?.[1]?.contents?.[0],
);
check(
  'теория: нет содержимого других типов',
  theoryDoc?.questions === undefined && theoryDoc?.memoCells === undefined && theoryDoc?.terms === undefined,
  Object.keys(theoryDoc ?? {}),
);

// ===== тест =====
const testDoc = blocks[1];
const questions = testDoc?.questions ?? [];
check(
  'тест: вопросы по порядку',
  questions.map((question) => question.type).join(',') === 'single,match,card',
  questions.map((question) => question.type),
);
check(
  'тест: группа и пояснение',
  questions[0]?.group?.name === 'Группа печати' && questions[0]?.explanation?.type === 'doc',
  { group: questions[0]?.group, explanation: questions[0]?.explanation?.type },
);
check(
  'тест: варианты по порядку, верный отмечен',
  questions[0]?.options?.map((option) => option.text).join(',') === '4,5' && questions[0]?.options?.[0]?.isCorrect === true,
  questions[0]?.options,
);
check(
  'тест: пары по порядку',
  questions[1]?.pairs?.map((pair) => `${pair.left}-${pair.right}`).join(',') === 'a-1,b-2',
  questions[1]?.pairs,
);
check(
  'тест: карточка front/back',
  questions[2]?.data?.front === 'Вопрос' && questions[2]?.data?.back === 'Ответ',
  questions[2]?.data,
);
check('тест: нет слайдов/памятки/терминов', testDoc?.slides === undefined && testDoc?.memoSlides === undefined && testDoc?.terms === undefined);

// ===== памятка и глоссарий =====
/** Тело карточки: новый набор фрагментов или старый Tiptap-документ. */
const isCardBody = (value) =>
  value?.version === 2 ? Array.isArray(value.contents) : value?.type === 'doc';

const memoDoc = blocks[2];
check(
  'памятка: слайды по порядку',
  memoDoc?.memoSlides?.map((slide) => slide.title).join(',') === 'Слайд 1,Слайд 2',
  memoDoc?.memoSlides?.map((slide) => slide.title),
);
check(
  'памятка: карточки по порядку внутри слайда',
  memoDoc?.memoSlides?.[0]?.cells?.map((cell) => cell.title).join(',') === 'Карточка 1,Карточка 2',
  memoDoc?.memoSlides?.[0]?.cells?.map((cell) => cell.title),
);
check(
  'памятка: тело карточки — набор фрагментов',
  isCardBody(memoDoc?.memoSlides?.[0]?.cells?.[0]?.body) &&
    JSON.stringify(memoDoc?.memoSlides?.[0]?.cells?.[0]?.body ?? '').includes('Первый текст'),
  memoDoc?.memoSlides?.[0]?.cells?.[0]?.body,
);

const glossaryDoc = blocks[3];
check(
  'глоссарий: термины по алфавиту',
  glossaryDoc?.terms?.map((term) => term.term).join(',') === 'Абрикос,Яблоко',
  glossaryDoc?.terms?.map((term) => term.term),
);
check(
  'глоссарий: определение — набор фрагментов',
  isCardBody(glossaryDoc?.terms?.[0]?.definition) &&
    JSON.stringify(glossaryDoc?.terms?.[0]?.definition ?? '').includes('фрукт'),
);

// ===== изоляция, пустой курс, свежесть, аудит =====
check('изоляция: блок другого курса не попал', !blocks.some((block) => block.id === otherBlock.id), otherBlock.id);

const empty = await req(`/api/courses/${emptyCourse.id}/print`, { token });
check(
  'пустой курс: 200 и пустой список блоков',
  empty.status === 200 && Array.isArray(empty.body?.course?.blocks) && empty.body.course.blocks.length === 0,
  { status: empty.status, blocks: empty.body?.course?.blocks },
);

const auditCount = await prisma.auditLog.count({ where: { entity: 'Course', createdAt: { gte: startedAt } } });
check('аудит: GET print не пишет журнал', auditCount === 0, auditCount);

await req(`/api/courses/${course.id}`, { method: 'PUT', token, body: { title: `${TEST_PREFIX} печать (новое)` } });
const fresh = await req(`/api/courses/${course.id}/print`, { token });
check('свежесть: новое название после PUT', fresh.body?.course?.title === `${TEST_PREFIX} печать (новое)`, fresh.body?.course?.title);

// ===== очистка =====
await pause();
await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
await prisma.auditLog.deleteMany({ where: { entity: 'Course', createdAt: { gte: startedAt } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step15-' } } });

check(
  'очистка: тестовые курсы удалены',
  (await prisma.course.count({ where: { title: { startsWith: TEST_PREFIX } } })) === 0,
);
check('очистка: тестовые пользователи удалены', (await prisma.user.count({ where: { login: { startsWith: 'step15-' } } })) === 0);

const out = {
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
fs.writeFileSync('step15-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-step15: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((entry) => !entry.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;

