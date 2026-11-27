/**
 * Смоук Шага 13: импорт курса из ZIP-архива.
 * Запуск (из папки server): node scripts/smoke-step13.mjs
 *
 * Экспорта ещё нет (Шаг 14), поэтому архив собирается в самом скрипте:
 * course.json + files/pixel.png. Проверяются разбор архива, права, откат
 * при ошибках и главное — замена fileId/url картинок на новые.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
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

/** POST /api/courses/import с архивом в поле `file`. */
function sendArchive(buffer, { token, filename = 'course.zip' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/zip' }), filename);
  return req('/api/courses/import', { method: 'POST', form, token });
}

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });
// Аудит пишется в res.on('finish') асинхронно — даём записи дойти до БД
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = new Date();
const TEST_PREFIX = 'Шаг 13:';

// 1×1 PNG — настоящая картинка, которую можно отдать статикой и сверить по байтам
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const textDoc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Манифест курса: теория с картинкой, тест, памятка и глоссарий. */
function buildManifest({ fileId, url, overrides = {} } = {}) {
  return {
    format: 'course-builder',
    version: 1,
    exportedAt: new Date().toISOString(),
    course: { title: `${TEST_PREFIX} импорт`, description: 'Проверка импорта архива' },
    files: fileId ? [{ id: fileId, path: url, name: 'files/pixel.png', mimeType: 'image/png' }] : [],
    blocks: [
      {
        type: 'theory',
        title: 'Теория',
        description: 'Слайды с текстом и картинкой',
        coverImage: url ?? null,
        slides: [
          {
            title: 'Слайд 1',
            contents: [
              { type: 'text', width: 66, data: textDoc('Первый слайд') },
              {
                type: 'image',
                width: 33,
                data: { fileId: fileId ?? null, url: url ?? '', alt: 'Пиксель', caption: 'Точка', width: 100, align: 'center' },
              },
            ],
          },
          {
            title: 'Слайд 2',
            contents: [
              {
                type: 'checklist',
                data: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: 'Пункт', checked: true }] },
              },
            ],
          },
        ],
      },
      {
        type: 'test',
        title: 'Тест',
        groups: [{ name: 'Группа A' }],
        questions: [
          {
            type: 'single',
            data: { text: 'Сколько будет 2 + 2?' },
            options: [
              { text: '4', isCorrect: true },
              { text: '5', isCorrect: false },
            ],
            explanation: textDoc('Потому что'),
            groupIndex: 0,
          },
          {
            type: 'match',
            data: { text: 'Сопоставьте буквы и цифры' },
            pairs: [
              { left: 'a', right: '1' },
              { left: 'b', right: '2' },
            ],
          },
          { type: 'card', data: { front: 'Вопрос', back: 'Ответ' } },
        ],
      },
      {
        type: 'memo',
        title: 'Памятка',
        memoSlides: [{ title: 'Слайд 1', cells: [{ title: 'Карточка', body: textDoc('Не забыть') }] }],
      },
      {
        type: 'glossary',
        title: 'Глоссарий',
        terms: [{ term: 'Курс', definition: textDoc('Набор блоков') }],
      },
    ],
    ...overrides,
  };
}

/** ZIP с манифестом; картинка кладётся в files/pixel.png (или во вложенную папку). */
function buildArchive(manifest, { withImage = true, prefix = '' } = {}) {
  const zip = new AdmZip();
  zip.addFile(`${prefix}course.json`, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  if (withImage) zip.addFile(`${prefix}files/pixel.png`, PIXEL_PNG);
  return zip.toBuffer();
}

/** Байты по адресу /uploads/... через тот же сервер. */
async function fetchUpload(url) {
  const res = await fetch(base + url);
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

const uploadedPaths = () => fs.readdirSync(UPLOADS_DIR);

// ===== чистая песочница =====
await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step13-' } } });

const reader = await prisma.user.create({
  data: { login: 'step13-reader', passwordHash: 'not-used', role: 'reader' },
});
const readerToken = signToken(reader);

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

const courseCount = () => prisma.course.count();
const fileCount = () => prisma.file.count();

check('POST /courses/import без токена -> 401', (await sendArchive(buildArchive(buildManifest()))).status === 401);

const readerImport = await sendArchive(buildArchive(buildManifest()), { token: readerToken });
check('POST /courses/import reader-ом -> 403', readerImport.status === 403, readerImport.status);

// Исходная картинка: грузим через API, как это делает редактор слайда.
const sourceForm = new FormData();
sourceForm.append('file', new Blob([PIXEL_PNG], { type: 'image/png' }), 'pixel.png');
const uploaded = await req('/api/files', { method: 'POST', token, form: sourceForm });
const sourceFile = uploaded.body?.file;
check('исходная картинка загружена', uploaded.status === 201 && Boolean(sourceFile?.id), uploaded.status);

const sourceImage = await fetchUpload(sourceFile.url);
check('исходная картинка отдаётся статикой', sourceImage.status === 200);

// ===== ошибки разбора: 400 и ничего не создано =====
const coursesBefore = await courseCount();
const filesBefore = await fileCount();
const uploadsBefore = uploadedPaths().length;

const manifestWithSource = (overrides) =>
  buildManifest({ fileId: sourceFile.id, url: sourceFile.url, overrides });

const notZip = await sendArchive(Buffer.from('это не архив', 'utf8'), { token });
check('не ZIP -> 400', notZip.status === 400 && /ZIP/.test(notZip.body?.message ?? ''), notZip.body);

const onlyFiles = new AdmZip();
onlyFiles.addFile('files/pixel.png', PIXEL_PNG);
const noManifest = await sendArchive(onlyFiles.toBuffer(), { token });
check(
  'архив без course.json -> 400',
  noManifest.status === 400 && /course\.json/.test(noManifest.body?.message ?? ''),
  noManifest.body,
);

const brokenJsonZip = new AdmZip();
brokenJsonZip.addFile('course.json', Buffer.from('{ "course": ', 'utf8'));
const brokenJson = await sendArchive(brokenJsonZip.toBuffer(), { token });
check('битый JSON -> 400', brokenJson.status === 400, brokenJson.body);

const wrongFormat = await sendArchive(
  buildArchive(manifestWithSource({ format: 'other-format' })),
  { token },
);
check('чужой format -> 400', wrongFormat.status === 400, wrongFormat.body);

const futureVersion = await sendArchive(buildArchive(manifestWithSource({ version: 99 })), { token });
check(
  'версия архива новее -> 400',
  futureVersion.status === 400 && /версия/i.test(futureVersion.body?.message ?? ''),
  futureVersion.body,
);

const emptyTitle = await sendArchive(
  buildArchive(manifestWithSource({ course: { title: '   ' } })),
  { token },
);
check('пустое название курса -> 400', emptyTitle.status === 400, emptyTitle.body);

const badBlockType = await sendArchive(
  buildArchive(manifestWithSource({ blocks: [{ type: 'quiz', title: 'Блок' }] })),
  { token },
);
check(
  'неизвестный тип блока -> 400',
  badBlockType.status === 400 && badBlockType.body?.message?.includes('blocks[0].type'),
  badBlockType.body,
);

const extraContent = await sendArchive(
  buildArchive(
    manifestWithSource({
      blocks: [{ type: 'theory', title: 'Теория', questions: [{ type: 'card', data: { front: 'a' } }] }],
    }),
  ),
  { token },
);
check('чужое содержимое у блока -> 400', extraContent.status === 400, extraContent.body);

const missingFile = await sendArchive(
  buildArchive(manifestWithSource(), { withImage: false }),
  { token },
);
check(
  'файла из манифеста нет в ZIP -> 400',
  missingFile.status === 400 && /в архиве нет файла/.test(missingFile.body?.message ?? ''),
  missingFile.body,
);

const missingRef = await sendArchive(
  buildArchive(
    manifestWithSource({
      files: [],
      blocks: [
        {
          type: 'theory',
          title: 'Теория',
          slides: [
            {
              contents: [
                { type: 'image', data: { fileId: sourceFile.id, url: sourceFile.url, alt: '', caption: '' } },
              ],
            },
          ],
        },
      ],
    }),
  ),
  { token },
);
check(
  'картинка ссылается на файл вне архива -> 400',
  missingRef.status === 400 && /отсутствует в архиве/.test(missingRef.body?.message ?? ''),
  missingRef.body,
);

const noCorrectOption = await sendArchive(
  buildArchive(
    manifestWithSource({
      blocks: [
        {
          type: 'test',
          title: 'Тест',
          questions: [
            {
              type: 'single',
              data: { text: 'Вопрос' },
              options: [
                { text: 'a', isCorrect: false },
                { text: 'b', isCorrect: false },
              ],
            },
          ],
        },
      ],
    }),
  ),
  { token },
);
check('вопрос без верного варианта -> 400', noCorrectOption.status === 400, noCorrectOption.body);

const badGroupIndex = await sendArchive(
  buildArchive(
    manifestWithSource({
      blocks: [
        {
          type: 'test',
          title: 'Тест',
          groups: [{ name: 'Одна' }],
          questions: [{ type: 'card', data: { front: 'a' }, groupIndex: 5 }],
        },
      ],
    }),
  ),
  { token },
);
check('groupIndex вне диапазона -> 400', badGroupIndex.status === 400, badGroupIndex.body);

const futureData = await sendArchive(
  buildArchive(
    manifestWithSource({
      blocks: [
        {
          type: 'theory',
          title: 'Теория',
          slides: [{ contents: [{ type: 'text', dataVersion: 99, data: textDoc('текст') }] }],
        },
      ],
    }),
  ),
  { token },
);
check('dataVersion новее -> 400', futureData.status === 400, futureData.body);


check('ошибки не создали курсы', (await courseCount()) === coursesBefore);
check('ошибки не создали записи File', (await fileCount()) === filesBefore);
check('ошибки не оставили файлов на диске', uploadedPaths().length === uploadsBefore);

// ===== успешный импорт =====
const importResponse = await sendArchive(buildArchive(manifestWithSource()), { token });
const imported = importResponse.body?.course;
const stats = importResponse.body?.stats;

check('POST /courses/import -> 201', importResponse.status === 201, importResponse.body?.message);
check(
  'stats: 4 блока, 2 слайда, 3 фрагмента, 1 группа, 3 вопроса, 1 карточка, 1 термин, 1 файл',
  stats?.blocks === 4 &&
    stats?.slides === 2 &&
    stats?.contents === 3 &&
    stats?.groups === 1 &&
    stats?.questions === 3 &&
    stats?.memoSlides === 1 &&
    stats?.memoCells === 1 &&
    stats?.terms === 1 &&
    stats?.files === 1,
  stats,
);

const courseId = imported?.id;
const detail = await req(`/api/courses/${courseId}`, { token });
const blocks = detail.body?.course?.blocks ?? [];
check(
  'GET /courses/:id: блоки в порядке архива',
  blocks.map((block) => block.type).join(',') === 'theory,test,memo,glossary',
  blocks.map((block) => block.type).join(','),
);
check(
  'заголовок и описание курса из архива',
  detail.body?.course?.title === `${TEST_PREFIX} импорт` && Boolean(detail.body?.course?.description),
);

const list = await req('/api/courses', { token });
check('импортированный курс попал в список', (list.body?.courses ?? []).some((course) => course.id === courseId));

const theoryId = blocks.find((block) => block.type === 'theory')?.id;
const slides = await req(`/api/slides?blockId=${theoryId}`, { token });
const slideList = slides.body?.slides ?? [];
check('теория: 2 слайда с содержимым', slideList.length === 2 && (slideList[0]?.contents?.length ?? 0) === 2);

const imageContent = (slideList[0]?.contents ?? []).find((content) => content.type === 'image');
check('картинка: ширина колонки из архива', imageContent?.width === 33, imageContent?.width);
check(
  'картинка: fileId заменён на новый',
  Boolean(imageContent?.data?.fileId) && imageContent.data.fileId !== sourceFile.id,
  `${sourceFile.id} -> ${imageContent?.data?.fileId}`,
);
check(
  'картинка: url заменён на новый',
  typeof imageContent?.data?.url === 'string' &&
    imageContent.data.url.startsWith('/uploads/') &&
    imageContent.data.url !== sourceFile.url,
  `${sourceFile.url} -> ${imageContent?.data?.url}`,
);

const newImage = await fetchUpload(imageContent.data.url);
check('новый файл отдаётся и совпадает по байтам', newImage.status === 200 && newImage.buffer.equals(PIXEL_PNG));

const oldImage = await fetchUpload(sourceFile.url);
check('исходный файл курса-источника не тронут', oldImage.status === 200 && oldImage.buffer.equals(PIXEL_PNG));

const importedFile = await prisma.file.findUnique({
  where: { id: imageContent.data.fileId },
  select: { path: true, mimeType: true, size: true },
});
check(
  'File: путь, тип и размер',
  importedFile?.path === imageContent.data.url &&
    importedFile.mimeType === 'image/png' &&
    importedFile.size === PIXEL_PNG.length,
  importedFile,
);

check(
  'обложка блока переехала на новый файл',
  blocks.find((block) => block.type === 'theory')?.coverImage === imageContent.data.url,
);


// ===== тест, памятка, глоссарий =====
const testId = blocks.find((block) => block.type === 'test')?.id;
const groups = await req(`/api/test-groups?blockId=${testId}`, { token });
const questions = await req(`/api/questions?blockId=${testId}`, { token });
const questionList = questions.body?.questions ?? [];

check('тест: одна группа', (groups.body?.groups ?? []).length === 1);
check('тест: три вопроса в порядке архива', questionList.length === 3);

const single = questionList.find((question) => question.type === 'single');
check(
  'single: два варианта, один верный, группа по groupIndex',
  (single?.options ?? []).length === 2 &&
    (single?.options ?? []).filter((option) => option.isCorrect).length === 1 &&
    single?.groupId === groups.body?.groups?.[0]?.id,
  single?.groupId,
);
check('пояснение вопроса — Tiptap-документ', single?.explanation?.type === 'doc');

const match = questionList.find((question) => question.type === 'match');
check('match: две пары', (match?.pairs ?? []).length === 2);

const card = questionList.find((question) => question.type === 'card');
check('card: без вариантов, стороны на месте', (card?.options ?? []).length === 0 && card?.data?.front === 'Вопрос');

const memoId = blocks.find((block) => block.type === 'memo')?.id;
const cells = await req(`/api/memo-cells?blockId=${memoId}`, { token });
check(
  'памятка: карточка с заголовком и текстом',
  cells.body?.cells?.[0]?.title === 'Карточка' && Boolean(cells.body?.cells?.[0]?.body),
);

const glossaryId = blocks.find((block) => block.type === 'glossary')?.id;
const terms = await req(`/api/terms?blockId=${glossaryId}`, { token });
check(
  'глоссарий: термин с определением',
  terms.body?.terms?.[0]?.term === 'Курс' && Boolean(terms.body?.terms?.[0]?.definition),
);

// ===== повторный импорт: файлы не переиспользуются =====
const secondResponse = await sendArchive(buildArchive(manifestWithSource()), { token });
check('повторный импорт того же архива -> 201', secondResponse.status === 201, secondResponse.body?.message);

const secondDetail = await req(`/api/courses/${secondResponse.body?.course?.id}`, { token });
const secondTheoryId = (secondDetail.body?.course?.blocks ?? []).find((block) => block.type === 'theory')?.id;
const secondSlides = await req(`/api/slides?blockId=${secondTheoryId}`, { token });
const secondImage = (secondSlides.body?.slides?.[0]?.contents ?? []).find((content) => content.type === 'image');

check(
  'повторный импорт: у картинки свой новый fileId',
  Boolean(secondImage?.data?.fileId) && secondImage.data.fileId !== imageContent.data.fileId,
  `${imageContent.data?.fileId} vs ${secondImage?.data?.fileId}`,
);
check('повторный импорт: новый файл доступен', (await fetchUpload(secondImage.data.url)).status === 200);

// ===== архив с вложенной папкой =====
const nestedResponse = await sendArchive(
  buildArchive(manifestWithSource({ course: { title: `${TEST_PREFIX} вложенная папка` } }), {
    prefix: 'course/',
  }),
  { token },
);
check('архив с course/ внутри -> 201', nestedResponse.status === 201, nestedResponse.body?.message);

// ===== аудит =====
await pause();
const courseAudit = await prisma.auditLog.findFirst({
  where: { entity: 'Course', action: 'create', entityId: courseId, createdAt: { gte: startedAt } },
  select: { userId: true },
});
check('аудит: create Course с entityId импортированного курса', Boolean(courseAudit?.userId), courseAudit);

// ===== очистка =====
const testFiles = await prisma.file.findMany({
  where: { createdAt: { gte: startedAt } },
  select: { id: true, path: true },
});

await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
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
await prisma.user.deleteMany({ where: { login: { startsWith: 'step13-' } } });

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
fs.writeFileSync('step13-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-step13: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((entry) => !entry.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;

