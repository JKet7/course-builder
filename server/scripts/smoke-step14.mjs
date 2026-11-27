/**
 * Смоук Шага 14: экспорт курса в ZIP и round-trip с импортом Шага 13.
 * Запуск (из папки server): node scripts/smoke-step14.mjs
 *
 * Проверяется: права на GET /api/courses/:id/export, содержимое архива
 * (course.json + files/), валидность манифеста для импорта, совпадение байтов
 * картинки, полный цикл экспорт → импорт → экспорт, отказ 409 при потере файла
 * на диске и отсутствие записи в аудите (GET не аудируется).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { readCourseArchive } from '../src/utils/courseArchive.js';
import { normalizeContentData } from '../src/utils/content.js';
import { normalizeContentBody } from '../src/utils/contentBody.js';
import { downloadFileName } from '../src/utils/courseExport.js';
import { signToken } from '../src/utils/jwt.js';
import { UPLOADS_DIR } from '../src/utils/uploads.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(pathname, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(base + pathname, {
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

  return { status: res.status, body: json };
}

/** GET архива: бинарный ответ + заголовки. */
async function download(pathname, token) {
  const res = await fetch(base + pathname, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return {
    status: res.status,
    headers: res.headers,
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

/** POST /api/courses/import с архивом в поле `file`. */
function sendArchive(buffer, { token, filename = 'course.zip' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/zip' }), filename);
  return req('/api/courses/import', { method: 'POST', form, token });
}

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = new Date();
const TEST_PREFIX = 'Шаг 14:';

// 1×1 PNG — сверяем байты картинки в архиве и после импорта.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const textDoc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Имя из Content-Disposition: filename* (UTF-8) или обычный filename. */
function headerFilename(header) {
  const value = String(header ?? '');

  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return null;
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

/** Ключи объектов в стабильном порядке — сравнение не зависит от порядка полей. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }

  return value;
}

/** Манифест из архива без «плавающих» полей — для сравнения round-trip. */
/** Первое расхождение двух JSON-значений: путь и сами значения. */
function firstDifference(a, b, at = '') {
  if (a === b) return null;
  if (a === undefined || b === undefined) return { at: at || '<root>', first: a, second: b };

  const bothObjects = typeof a === 'object' && typeof b === 'object' && a !== null && b !== null;
  if (!bothObjects) return { at: at || '<root>', first: a, second: b };

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = firstDifference(a[key], b[key], at ? `${at}.${key}` : key);
    if (found) return found;
  }

  return null;
}

/**
 * Тело карточки в едином виде: серверный normalizer принимает и старый
 * Tiptap-документ, и новый набор фрагментов, поэтому сравнение манифестов не
 * зависит от того, в какой форме запись лежит в БД (экспорт копирует данные
 * как есть, импорт нормализует их).
 */
function cardBodyView(value) {
  const normalized = normalizeContentBody(value);
  return normalized.ok ? normalized.body : value;
}

function normalizeManifest(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));

  delete clone.exportedAt;
  clone.files = clone.files.map((file) => ({ mimeType: file.mimeType }));

  for (const block of clone.blocks) {
    if (block.coverImage) block.coverImage = '<cover>';

    for (const slide of block.memoSlides ?? []) {
      for (const cell of slide.cells ?? []) cell.body = cardBodyView(cell.body);
    }
    for (const term of block.terms ?? []) term.definition = cardBodyView(term.definition);

    for (const slide of block.slides ?? []) {
      for (const content of slide.contents) {
        // Импорт прогоняет данные фрагмента через normalizeContentData
        // (появляются значения по умолчанию, например aspect: null),
        // экспорт — копирует данные как есть. Сравниваем после нормализации.
        const data = normalizeContentData(content.type, content.data);
        if (data.ok) content.data = data.data;

        if (content.type === 'image' && content.data?.fileId) {
          content.data.fileId = '<file>';
          content.data.url = '<url>';
        }
      }
    }
  }

  return stable(clone);
}

// ===== чистая песочница =====
await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step14-' } } });

const reader = await prisma.user.create({
  data: { login: 'step14-reader', passwordHash: 'not-used', role: 'reader' },
});
const readerToken = signToken(reader);

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

// ===== курс со всеми типами блоков и картинкой =====
const uploadName = `step14-${Date.now().toString(36)}.png`;
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.writeFileSync(path.join(UPLOADS_DIR, uploadName), PIXEL_PNG);

const imageFile = await prisma.file.create({
  data: { path: `/uploads/${uploadName}`, mimeType: 'image/png', size: PIXEL_PNG.length },
});

const course = await prisma.course.create({
  data: { title: `${TEST_PREFIX} экспорт`, description: 'Проверка экспорта в ZIP', order: 1000 },
});

const theory = await prisma.block.create({
  data: {
    courseId: course.id,
    type: 'theory',
    title: 'Теория',
    description: 'Слайды с текстом и картинкой',
    coverImage: imageFile.path,
    order: 0,
  },
});

const slideOne = await prisma.theorySlide.create({
  data: { blockId: theory.id, title: 'Слайд 1', order: 0 },
});

await prisma.theoryContent.createMany({
  data: [
    { slideId: slideOne.id, type: 'text', data: textDoc('Первый слайд'), width: 66, order: 0 },
    {
      slideId: slideOne.id,
      type: 'image',
      data: {
        fileId: imageFile.id,
        url: imageFile.path,
        alt: 'Пиксель',
        caption: 'Точка',
        width: 100,
        align: 'center',
      },
      width: 33,
      order: 1,
    },
  ],
});

const slideTwo = await prisma.theorySlide.create({
  data: { blockId: theory.id, title: 'Слайд 2', order: 1 },
});

await prisma.theoryContent.create({
  data: {
    slideId: slideTwo.id,
    type: 'checklist',
    data: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: 'Пункт', checked: true }] },
    order: 0,
  },
});

const testBlock = await prisma.block.create({
  data: { courseId: course.id, type: 'test', title: 'Тест', description: 'Вопросы всех типов', order: 1 },
});

const group = await prisma.testGroup.create({
  data: { blockId: testBlock.id, name: 'Группа A', order: 0 },
});

const singleQuestion = await prisma.testQuestion.create({
  data: {
    blockId: testBlock.id,
    groupId: group.id,
    type: 'single',
    data: { text: 'Сколько будет 2 + 2?' },
    explanation: textDoc('Потому что'),
    order: 0,
  },
});

await prisma.testOption.createMany({
  data: [
    { questionId: singleQuestion.id, text: '4', isCorrect: true, order: 0 },
    { questionId: singleQuestion.id, text: '5', isCorrect: false, order: 1 },
  ],
});

const matchQuestion = await prisma.testQuestion.create({
  data: { blockId: testBlock.id, type: 'match', data: { text: 'Сопоставьте' }, order: 1 },
});

await prisma.testPair.createMany({
  data: [
    { questionId: matchQuestion.id, left: 'a', right: '1', order: 0 },
    { questionId: matchQuestion.id, left: 'b', right: '2', order: 1 },
  ],
});

await prisma.testQuestion.create({
  data: { blockId: testBlock.id, type: 'card', data: { front: 'Вопрос', back: 'Ответ' }, order: 2 },
});

const memoBlock = await prisma.block.create({
  data: { courseId: course.id, type: 'memo', title: 'Памятка', order: 2 },
});

const memoSlide = await prisma.memoSlide.create({
  data: { blockId: memoBlock.id, title: 'Слайд 1', order: 0 },
});

const memoTitleDoc = textDoc('Форматированная карточка');

await prisma.memoCell.create({
  data: {
    blockId: memoBlock.id,
    slideId: memoSlide.id,
    title: 'Форматированная карточка',
    titleDoc: memoTitleDoc,
    body: textDoc('Не забыть'),
    order: 0,
  },
});

const glossaryBlock = await prisma.block.create({
  data: { courseId: course.id, type: 'glossary', title: 'Глоссарий', order: 3 },
});

await prisma.glossaryTerm.createMany({
  data: [
    { blockId: glossaryBlock.id, term: 'Курс', definition: textDoc('Набор блоков') },
    { blockId: glossaryBlock.id, term: 'Блок', definition: textDoc('Часть курса') },
  ],
});

// ===== права на экспорт =====
const noToken = await download(`/api/courses/${course.id}/export`);
check('экспорт без токена -> 401', noToken.status === 401, noToken.status);

const readerExport = await download(`/api/courses/${course.id}/export`, readerToken);
check('экспорт reader-ом -> 403', readerExport.status === 403, readerExport.status);

const unknownExport = await download('/api/courses/no-such-course/export', token);
check('экспорт неизвестного курса -> 404', unknownExport.status === 404, unknownExport.status);

// ===== успешный экспорт =====
const auditBefore = await prisma.auditLog.count();
const exported = await download(`/api/courses/${course.id}/export`, token);
const disposition = exported.headers.get('content-disposition');
const expectedName = downloadFileName(course.title);

check('экспорт -> 200', exported.status === 200, exported.status);
check(
  'Content-Type: application/zip',
  /application\/zip/.test(exported.headers.get('content-type') ?? ''),
  exported.headers.get('content-type'),
);
check(
  'Content-Length совпадает с телом',
  Number(exported.headers.get('content-length')) === exported.buffer.length,
  exported.headers.get('content-length'),
);
check('тело начинается с PK', exported.buffer[0] === 0x50 && exported.buffer[1] === 0x4b);
check('Content-Disposition: attachment', /^attachment;/.test(disposition ?? ''), disposition);
check(
  'Content-Disposition: ASCII-имя без кириллицы',
  /filename="[a-z0-9-]*\.zip"/.test(disposition ?? ''),
  disposition,
);
check(
  'Content-Disposition: имя с названием курса (UTF-8)',
  headerFilename(disposition) === expectedName,
  { actual: headerFilename(disposition), expected: expectedName },
);
check('аудит: GET-экспорт не пишет AuditLog', (await prisma.auditLog.count()) === auditBefore);

const zip = new AdmZip(exported.buffer);
const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
const manifest = JSON.parse(zip.readAsText('course.json'));

check('в архиве есть course.json', entryNames.includes('course.json'));
check('в архиве есть files/ с картинкой', entryNames.filter((name) => name.startsWith('files/')).length === 1);
check('манифест: format и version', manifest.format === 'course-builder' && manifest.version === 1);
check(
  'манифест: название и описание курса',
  manifest.course.title === course.title && manifest.course.description === course.description,
);
check(
  'манифест: 4 блока в исходном порядке',
  manifest.blocks.map((block) => block.type).join(',') === 'theory,test,memo,glossary',
  manifest.blocks.map((block) => block.type),
);

const theoryJson = manifest.blocks[0];
const [textContent, imageContent] = theoryJson.slides[0].contents;

check('теория: два слайда', theoryJson.slides.length === 2);
check('теория: обложка указывает на картинку', theoryJson.coverImage === imageFile.path);
check(
  'теория: картинка ссылается на исходный файл',
  imageContent.type === 'image' &&
    imageContent.data.fileId === imageFile.id &&
    imageContent.data.url === imageFile.path,
  imageContent.data,
);
check(
  'теория: ширины колонок сохранены',
  textContent.width === 66 && imageContent.width === 33,
  [textContent.width, imageContent.width],
);
check(
  'теория: чек-лист на втором слайде',
  theoryJson.slides[1].contents[0].type === 'checklist' &&
    theoryJson.slides[1].contents[0].data.items[0].text === 'Пункт',
);

const testJson = manifest.blocks[1];
const [singleJson, matchJson, cardJson] = testJson.questions;

check(
  'тест: группа и три вопроса',
  testJson.groups.length === 1 && testJson.groups[0].name === 'Группа A' && testJson.questions.length === 3,
);
check('тест: вопрос группы получает groupIndex', singleJson.groupIndex === 0, singleJson.groupIndex);
check(
  'тест: варианты и пояснение',
  singleJson.options.length === 2 && singleJson.options[0].isCorrect === true && singleJson.explanation?.type === 'doc',
  singleJson.options,
);
check(
  'тест: пары сопоставления',
  matchJson.type === 'match' && matchJson.pairs.length === 2 && matchJson.pairs[1].right === '2',
);
check('тест: карточка', cardJson.type === 'card' && cardJson.data.front === 'Вопрос');
check(
  'памятка: слайд с карточкой и телом из фрагментов',
  manifest.blocks[2].memoSlides.length === 1 &&
    manifest.blocks[2].memoSlides[0].cells.length === 1 &&
    manifest.blocks[2].memoSlides[0].cells[0].titleDoc?.type === 'doc' &&
    cardBodyView(manifest.blocks[2].memoSlides[0].cells[0].body).contents[0].type === 'text',
  manifest.blocks[2].memoSlides,
);
check(
  'глоссарий: два термина',
  manifest.blocks[3].terms.length === 2 &&
    manifest.blocks[3].terms.every((term) => cardBodyView(term.definition).contents.length === 1),
  manifest.blocks[3].terms,
);
check(
  'манифест: одна картинка с mimeType',
  manifest.files.length === 1 && manifest.files[0].mimeType === 'image/png',
  manifest.files,
);

const imageEntry = manifest.files[0] ? zip.getEntry(manifest.files[0].name) : null;
check(
  'картинка в архиве совпадает по байтам',
  Boolean(imageEntry) && imageEntry.getData().equals(PIXEL_PNG),
);

const parsed = readCourseArchive(exported.buffer);
check('архив проходит валидатор импорта', parsed.ok === true, parsed.message);

// ===== round-trip: импорт экспортированного архива =====
const imported = await sendArchive(exported.buffer, { token });
const stats = imported.body?.stats;

check('импорт экспортированного архива -> 201', imported.status === 201, imported.body);
check(
  'импорт: счётчики совпадают',
  stats?.blocks === 4 &&
    stats.slides === 2 &&
    stats.contents === 3 &&
    stats.groups === 1 &&
    stats.questions === 3 &&
    stats.memoSlides === 1 &&
    stats.memoCells === 1 &&
    stats.terms === 2 &&
    stats.files === 1,
  stats,
);
check(
  'импорт: название и описание курса',
  imported.body?.course?.title === course.title && imported.body?.course?.description === course.description,
);

const importedId = imported.body?.course?.id;
const reExported = await download(`/api/courses/${importedId}/export`, token);
check('повторный экспорт импортированного курса -> 200', reExported.status === 200, reExported.status);

const secondManifest = JSON.parse(new AdmZip(reExported.buffer).readAsText('course.json'));
const firstView = normalizeManifest(manifest);
const secondView = normalizeManifest(secondManifest);

check(
  'round-trip: манифесты эквивалентны',
  JSON.stringify(firstView) === JSON.stringify(secondView),
  firstDifference(firstView, secondView),
);

const importedFile = secondManifest.files[0]
  ? await prisma.file.findFirst({ where: { path: secondManifest.files[0].path } })
  : null;
const importedDisk = importedFile ? path.join(UPLOADS_DIR, path.basename(importedFile.path)) : '';

check(
  'импорт: картинка на диске под новым именем и с теми же байтами',
  Boolean(importedFile) &&
    importedFile.id !== imageFile.id &&
    fs.existsSync(importedDisk) &&
    fs.readFileSync(importedDisk).equals(PIXEL_PNG),
);
check(
  'импорт: картинка контента ссылается на новый файл',
  secondManifest.blocks[0].slides[0].contents[1].data.fileId === importedFile?.id,
);
check('импорт: обложка блока обновлена на новый файл', secondManifest.blocks[0].coverImage === importedFile?.path);

// ===== 409: файл из БД пропал с диска =====
const missingCourse = await prisma.course.create({
  data: { title: `${TEST_PREFIX} без файла`, order: 1001 },
});
const missingBlock = await prisma.block.create({
  data: { courseId: missingCourse.id, type: 'theory', title: 'Битый блок', order: 0 },
});
const missingSlide = await prisma.theorySlide.create({
  data: { blockId: missingBlock.id, order: 0 },
});
const missingFile = await prisma.file.create({
  data: { path: '/uploads/step14-missing.png', mimeType: 'image/png', size: 10 },
});

await prisma.theoryContent.create({
  data: {
    slideId: missingSlide.id,
    type: 'image',
    data: { fileId: missingFile.id, url: missingFile.path, alt: '', caption: '', width: 100, align: 'center' },
    order: 0,
  },
});

const missingExport = await download(`/api/courses/${missingCourse.id}/export`, token);
let missingBody = null;
try {
  missingBody = JSON.parse(missingExport.buffer.toString('utf8'));
} catch {
  missingBody = null;
}

check('файл пропал с диска -> 409', missingExport.status === 409, missingExport.status);
check(
  '409: сообщение про папку загрузок',
  /папке загрузок/.test(missingBody?.message ?? ''),
  missingBody,
);

// ===== курс без блоков =====
const emptyCourse = await prisma.course.create({ data: { title: `${TEST_PREFIX} пустой`, order: 1002 } });
const emptyExport = await download(`/api/courses/${emptyCourse.id}/export`, token);
const emptyManifest =
  emptyExport.status === 200 ? JSON.parse(new AdmZip(emptyExport.buffer).readAsText('course.json')) : null;

check(
  'курс без блоков: 200 и пустой манифест',
  emptyExport.status === 200 && emptyManifest?.blocks?.length === 0 && emptyManifest?.files?.length === 0,
  emptyManifest,
);

const emptyImport = await sendArchive(emptyExport.buffer, { token });
check(
  'курс без блоков импортируется',
  emptyImport.status === 201 && emptyImport.body?.stats?.blocks === 0,
  emptyImport.body,
);

// ===== картинка без файла и внешняя ссылка =====
const plainCourse = await prisma.course.create({
  data: { title: `${TEST_PREFIX} пустая картинка`, order: 1003 },
});
const plainBlock = await prisma.block.create({
  data: { courseId: plainCourse.id, type: 'theory', title: 'Пустые картинки', order: 0 },
});
const plainSlide = await prisma.theorySlide.create({
  data: { blockId: plainBlock.id, order: 0 },
});

await prisma.theoryContent.createMany({
  data: [
    {
      slideId: plainSlide.id,
      type: 'image',
      data: { fileId: null, url: '', alt: '', caption: '', width: 100, align: 'center' },
      order: 0,
    },
    {
      slideId: plainSlide.id,
      type: 'image',
      data: {
        fileId: null,
        url: 'https://example.com/pic.png',
        alt: 'Внешняя',
        caption: '',
        width: 100,
        align: 'center',
      },
      order: 1,
    },
  ],
});

const plainExport = await download(`/api/courses/${plainCourse.id}/export`, token);
const plainManifest =
  plainExport.status === 200 ? JSON.parse(new AdmZip(plainExport.buffer).readAsText('course.json')) : null;

check(
  'картинка без файла и внешняя ссылка: 200 без files/',
  plainExport.status === 200 && plainManifest?.files?.length === 0,
  { status: plainExport.status, files: plainManifest?.files },
);
check(
  'внешняя картинка сохранена как есть',
  plainManifest?.blocks[0].slides[0].contents[1].data.url === 'https://example.com/pic.png',
  plainManifest?.blocks[0].slides[0].contents[1].data,
);
check(
  'архив с внешней картинкой проходит валидатор импорта',
  plainExport.status === 200 && readCourseArchive(plainExport.buffer).ok === true,
);

// ===== очистка =====
await pause();
await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });

const testFiles = await prisma.file.findMany({
  where: { createdAt: { gte: startedAt } },
  select: { id: true, path: true },
});

await prisma.file.deleteMany({ where: { id: { in: testFiles.map((file) => file.id) } } });

for (const file of testFiles) {
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(file.path)));
  } catch {
    // файла уже нет — не мешает проверке
  }
}

await prisma.auditLog.deleteMany({
  where: { entity: { in: ['Course', 'File'] }, createdAt: { gte: startedAt } },
});
await prisma.user.deleteMany({ where: { login: { startsWith: 'step14-' } } });

check(
  'очистка: тестовые курсы удалены',
  (await prisma.course.count({ where: { title: { startsWith: TEST_PREFIX } } })) === 0,
);
check(
  'очистка: тестовые файлы удалены с диска',
  testFiles.every((file) => !fs.existsSync(path.join(UPLOADS_DIR, path.basename(file.path)))),
);

const out = {
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
fs.writeFileSync('step14-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-step14: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((entry) => !entry.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;
