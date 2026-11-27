/**
 * Смоук Шага 11: группы и вопросы теста, карточки памятки, термины глоссария.
 * Запуск (из папки server): node scripts/smoke-step11.mjs
 */
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

const docWithText = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

check('GET /terms без токена -> 401', (await req('/api/terms?blockId=x')).status === 401);

// ===== подготовка: курс и три блока =====
const courseRes = await req('/api/courses', {
  method: 'POST',
  token,
  body: { title: 'Шаг 11: смоук', description: 'временный курс' },
});
const course = courseRes.body?.course;
check('POST /courses -> 201', courseRes.status === 201 && Boolean(course?.id), courseRes);

const createBlock = async (type) => {
  const res = await req('/api/blocks', {
    method: 'POST',
    token,
    body: { courseId: course.id, type, title: `Блок ${type}` },
  });
  return res.body?.block;
};

const testBlock = await createBlock('test');
const memoBlock = await createBlock('memo');
const glossaryBlock = await createBlock('glossary');
check(
  'созданы блоки test/memo/glossary',
  Boolean(testBlock?.id && memoBlock?.id && glossaryBlock?.id),
  { testBlock, memoBlock, glossaryBlock },
);


// ===== группы теста =====
const groupA = await req('/api/test-groups', {
  method: 'POST',
  token,
  body: { blockId: testBlock.id, name: 'Основы' },
});
const groupB = await req('/api/test-groups', {
  method: 'POST',
  token,
  body: { blockId: testBlock.id, name: 'Практика' },
});
check(
  'POST /test-groups -> 201, порядок 0 и 1',
  groupA.status === 201 && groupB.status === 201 && groupA.body?.group?.order === 0 && groupB.body?.group?.order === 1,
  { groupA: groupA.body, groupB: groupB.body },
);

const emptyGroup = await req('/api/test-groups', {
  method: 'POST',
  token,
  body: { blockId: testBlock.id },
});
check(
  'POST /test-groups без названия -> имя по умолчанию',
  emptyGroup.status === 201 && emptyGroup.body?.group?.name === 'Новая группа',
  emptyGroup.body,
);

const renamed = await req(`/api/test-groups/${groupA.body.group.id}`, {
  method: 'PUT',
  token,
  body: { name: '  Базовые понятия  ' },
});
check(
  'PUT /test-groups/:id обрезает пробелы',
  renamed.status === 200 && renamed.body?.group?.name === 'Базовые понятия',
  renamed.body,
);

const groupList = await req(`/api/test-groups?blockId=${testBlock.id}`, { token });
check(
  'GET /test-groups -> 3 группы по порядку',
  groupList.status === 200 &&
    groupList.body?.groups?.length === 3 &&
    groupList.body.groups[0].name === 'Базовые понятия' &&
    groupList.body.groups[0].questionsCount === 0,
  groupList.body,
);

const groupsWrongBlock = await req(`/api/test-groups?blockId=${memoBlock.id}`, { token });
check('GET /test-groups чужого блока -> 400', groupsWrongBlock.status === 400, groupsWrongBlock.body);

// ===== вопросы: валидация и создание =====
const questionBase = { blockId: testBlock.id, groupId: groupA.body.group.id, data: { text: 'Что такое СИЗ?' } };

const single = await req('/api/questions', {
  method: 'POST',
  token,
  body: {
    ...questionBase,
    type: 'single',
    options: [
      { text: 'Средства индивидуальной защиты', isCorrect: true },
      { text: 'Служба инженерных знаний', isCorrect: false },
    ],
  },
});
check(
  'POST /questions single -> 201 с вариантами',
  single.status === 201 && single.body?.question?.options?.length === 2 && single.body.question.order === 0,
  single.body,
);

const twoCorrect = await req('/api/questions', {
  method: 'POST',
  token,
  body: {
    ...questionBase,
    type: 'single',
    options: [
      { text: 'А', isCorrect: true },
      { text: 'Б', isCorrect: true },
    ],
  },
});
check(
  'single с двумя верными -> 400 errors.question',
  twoCorrect.status === 400 && /ровно один/.test(twoCorrect.body?.errors?.question ?? ''),
  twoCorrect.body,
);

const oneOption = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, type: 'multiple', options: [{ text: 'Только один', isCorrect: true }] },
});
check(
  'multiple с одним вариантом -> 400',
  oneOption.status === 400 && Boolean(oneOption.body?.errors?.question),
  oneOption.body,
);

const badType = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, type: 'essay', options: [] },
});
check('тип essay -> 400 errors.type', badType.status === 400 && Boolean(badType.body?.errors?.type), badType.body);

const wrongBlock = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, blockId: memoBlock.id, type: 'single' },
});
check(
  'вопрос в блок «Памятка» -> 400',
  wrongBlock.status === 400 && /Тест/.test(wrongBlock.body?.message ?? ''),
  wrongBlock.body,
);

const multiple = await req('/api/questions', {
  method: 'POST',
  token,
  body: {
    ...questionBase,
    groupId: groupB.body.group.id,
    type: 'multiple',
    data: { text: 'Какие СИЗ обязательны?' },
    options: [
      { text: 'Каска', isCorrect: true },
      { text: 'Перчатки', isCorrect: true },
      { text: 'Шарф', isCorrect: false },
    ],
    explanation: docWithText('Смотри инструкцию по охране труда.'),
  },
});
check(
  'POST /questions multiple -> 201 с пояснением',
  multiple.status === 201 && multiple.body?.question?.options?.length === 3 && multiple.body.question.explanation?.type === 'doc',
  multiple.body,
);

const matchShort = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, type: 'match', data: { text: 'Сопоставьте' }, pairs: [{ left: 'А', right: '1' }] },
});
check('match с одной парой -> 400', matchShort.status === 400, matchShort.body);

const match = await req('/api/questions', {
  method: 'POST',
  token,
  body: {
    ...questionBase,
    type: 'match',
    data: { text: 'Сопоставьте понятия' },
    pairs: [
      { left: 'Каска', right: 'Головной убор' },
      { left: 'Респиратор', right: 'Защита дыхания' },
    ],
  },
});
check('POST /questions match -> 201 с парами', match.status === 201 && match.body?.question?.pairs?.length === 2, match.body);

const cardEmpty = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, type: 'card', data: { front: '  ', back: '' } },
});
check('card без сторон -> 400', cardEmpty.status === 400 && Boolean(cardEmpty.body?.errors?.question), cardEmpty.body);

const card = await req('/api/questions', {
  method: 'POST',
  token,
  body: { ...questionBase, type: 'card', data: { front: 'СИЗ', back: 'Средства индивидуальной защиты' } },
});
check(
  'POST /questions card -> 201',
  card.status === 201 && card.body?.question?.data?.front === 'СИЗ' && card.body.question.options.length === 0,
  card.body,
);

// ===== вопросы: чтение, обновление, порядок, удаление =====
const questionList = await req(`/api/questions?blockId=${testBlock.id}`, { token });
check(
  'GET /questions -> 4 вопроса по порядку',
  questionList.status === 200 &&
    questionList.body?.questions?.length === 4 &&
    questionList.body.questions.map((item) => item.type).join(',') === 'single,multiple,match,card',
  questionList.body?.questions?.map((item) => item.type),
);
check(
  'GET /questions: группа подтянута',
  questionList.body?.questions?.[0]?.group?.name === 'Базовые понятия',
  questionList.body?.questions?.[0]?.group,
);

const updatedQuestion = await req(`/api/questions/${single.body.question.id}`, {
  method: 'PUT',
  token,
  body: {
    type: 'multiple',
    data: { text: 'Что относится к СИЗ?' },
    options: [
      { text: 'Каска', isCorrect: true },
      { text: 'Перчатки', isCorrect: true },
      { text: 'Шарф', isCorrect: false },
    ],
    groupId: null,
  },
});
const optionsLeft = await prisma.testOption.count({ where: { questionId: single.body.question.id } });
check(
  'PUT /questions: тип и варианты заменены',
  updatedQuestion.status === 200 &&
    updatedQuestion.body?.question?.type === 'multiple' &&
    updatedQuestion.body.question.options.length === 3 &&
    updatedQuestion.body.question.groupId === null &&
    optionsLeft === 3,
  { status: updatedQuestion.status, optionsLeft, question: updatedQuestion.body?.question },
);

const clearedGroup = await req(`/api/test-groups?blockId=${testBlock.id}`, { token });
const groupCounts = clearedGroup.body?.groups ?? [];
check(
  'PUT /questions: вопрос убран из группы',
  groupCounts.find((group) => group.id === groupA.body.group.id)?.questionsCount === 2 &&
    groupCounts.find((group) => group.name === 'Новая группа')?.questionsCount === 0,
  groupCounts,
);

const reordered = await req('/api/questions/reorder', {
  method: 'PUT',
  token,
  body: {
    blockId: testBlock.id,
    orderedIds: [card.body.question.id, match.body.question.id, multiple.body.question.id, single.body.question.id],
  },
});
check(
  'PUT /questions/reorder -> card первым',
  reordered.status === 200 && reordered.body?.questions?.[0]?.id === card.body.question.id,
  reordered.body?.questions?.map((item) => item.id),
);

const foreignReorder = await req('/api/questions/reorder', {
  method: 'PUT',
  token,
  body: { blockId: memoBlock.id, orderedIds: [card.body.question.id] },
});
check('PUT /questions/reorder с чужим блоком -> 400', foreignReorder.status === 400, foreignReorder.body);

const incompleteOrder = await req('/api/questions/reorder', {
  method: 'PUT',
  token,
  body: { blockId: testBlock.id, orderedIds: [card.body.question.id] },
});
check(
  'PUT /questions/reorder с неполным списком -> 400',
  incompleteOrder.status === 400 && Array.isArray(incompleteOrder.body?.missingIds),
  incompleteOrder.body,
);

const deletedQuestion = await req(`/api/questions/${single.body.question.id}`, { method: 'DELETE', token });
const optionsAfterDelete = await prisma.testOption.count({ where: { questionId: single.body.question.id } });
check(
  'DELETE /questions/:id удаляет варианты',
  deletedQuestion.status === 200 && optionsAfterDelete === 0,
  { status: deletedQuestion.status, optionsAfterDelete },
);

const deletedGroup = await req(`/api/test-groups/${groupB.body.group.id}`, { method: 'DELETE', token });
const groupAfterDelete = await prisma.testGroup.count({ where: { id: groupB.body.group.id } });
const orphans = await prisma.testQuestion.count({ where: { blockId: testBlock.id, groupId: groupB.body.group.id } });
check(
  'DELETE /test-groups/:id обнуляет groupId у вопросов',
  deletedGroup.status === 200 && groupAfterDelete === 0 && orphans === 0,
  { status: deletedGroup.status, groupAfterDelete, orphans },
);

// ===== памятка =====
/** Текст тела карточки: новый набор фрагментов или старый Tiptap-документ. */
const docText = (value) => {
  const collect = (node) => {
    if (!node) return '';
    if (node.text) return node.text;
    return (node.content ?? []).map(collect).join(' ');
  };

  const fragments = value?.version === 2 && Array.isArray(value.contents) ? value.contents : [{ data: value }];
  return fragments.map((fragment) => collect(fragment?.data)).join(' ').trim();
};

const cell1 = await req('/api/memo-cells', { method: 'POST', token, body: { blockId: memoBlock.id } });
check(
  'POST /memo-cells -> 201 с заголовком по умолчанию',
  cell1.status === 201 &&
    cell1.body?.cell?.title === 'Новая карточка' &&
    cell1.body.cell.body?.version === 2 &&
    (cell1.body.cell.body?.contents ?? []).length === 0,
  cell1.body,
);

const cellUpdated = await req(`/api/memo-cells/${cell1.body.cell.id}`, {
  method: 'PUT',
  token,
  body: { title: 'Порядок действий', body: docWithText('Шаг 1. Надеть каску.') },
});
check(
  'PUT /memo-cells/:id сохраняет текст',
  cellUpdated.status === 200 &&
    cellUpdated.body?.cell?.title === 'Порядок действий' &&
    docText(cellUpdated.body.cell.body).includes('Надеть каску'),
  cellUpdated.body,
);

const richTitle = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { textAlign: 'right' },
      content: [
        {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: 'Нов',
        },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com', linkKind: 'external' } }],
          text: 'ый заголовок',
        },
      ],
    },
  ],
};

const richTitleUpdated = await req(`/api/memo-cells/${cell1.body.cell.id}`, {
  method: 'PUT',
  token,
  body: { titleDoc: richTitle },
});
check(
  'PUT /memo-cells/:id сохраняет форматированный заголовок и выводит из него title',
  richTitleUpdated.status === 200 &&
    richTitleUpdated.body?.cell?.title === 'Новый заголовок' &&
    richTitleUpdated.body?.cell?.titleDoc?.content?.[0]?.attrs?.textAlign === 'right' &&
    richTitleUpdated.body?.cell?.titleDoc?.content?.[0]?.content?.[0]?.marks?.[0]?.type === 'bold' &&
    richTitleUpdated.body?.cell?.titleDoc?.content?.[0]?.content?.[1]?.marks?.[0]?.type === 'link' &&
    docText(richTitleUpdated.body.cell.body).includes('Надеть каску'),
  richTitleUpdated.body,
);

const badMemoTitleDoc = await req(`/api/memo-cells/${cell1.body.cell.id}`, {
  method: 'PUT',
  token,
  body: { titleDoc: { type: 'paragraph' } },
});
check(
  'PUT /memo-cells с не-Tiptap заголовком -> 400 errors.title',
  badMemoTitleDoc.status === 400 && Boolean(badMemoTitleDoc.body?.errors?.title),
  badMemoTitleDoc.body,
);

const badMemoBody = await req(`/api/memo-cells/${cell1.body.cell.id}`, {
  method: 'PUT',
  token,
  body: { body: [] },
});
check(
  'PUT /memo-cells с массивом -> 400 errors.body',
  badMemoBody.status === 400 && Boolean(badMemoBody.body?.errors?.body),
  badMemoBody.body,
);

const emptyMemoTitle = await req(`/api/memo-cells/${cell1.body.cell.id}`, {
  method: 'PUT',
  token,
  body: { title: '   ' },
});
check(
  'PUT /memo-cells с пустым заголовком -> 400 errors.title',
  emptyMemoTitle.status === 400 && Boolean(emptyMemoTitle.body?.errors?.title),
  emptyMemoTitle.body,
);

const cell2 = await req('/api/memo-cells', {
  method: 'POST',
  token,
  body: { blockId: memoBlock.id, title: 'Вторая карточка', body: 'Текст из строки' },
});
check(
  'POST /memo-cells из строки -> Tiptap-документ',
  cell2.status === 201 && docText(cell2.body?.cell?.body) === 'Текст из строки',
  cell2.body,
);

const cellsReordered = await req('/api/memo-cells/reorder', {
  method: 'PUT',
  token,
  body: { blockId: memoBlock.id, orderedIds: [cell2.body.cell.id, cell1.body.cell.id] },
});
check(
  'PUT /memo-cells/reorder -> вторая карточка первой',
  cellsReordered.status === 200 && cellsReordered.body?.cells?.[0]?.id === cell2.body.cell.id,
  cellsReordered.body?.cells?.map((cell) => cell.id),
);

const memoGuard = await req(`/api/memo-cells?blockId=${testBlock.id}`, { token });
check('GET /memo-cells чужого блока -> 400', memoGuard.status === 400, memoGuard.body);

const deletedCell = await req(`/api/memo-cells/${cell2.body.cell.id}`, { method: 'DELETE', token });
check('DELETE /memo-cells/:id -> 200', deletedCell.status === 200, deletedCell.body);

// слайд памятки: несколько слайдов, в каждом своя сетка карточек
const firstSlideId = cell1.body.cell.slideId;
const newSlide = await req('/api/memo-slides', { method: 'POST', token, body: { blockId: memoBlock.id } });
check(
  'POST /memo-slides -> 201 с пустой карточкой',
  newSlide.status === 201 &&
    newSlide.body?.slide?.title === 'Новый слайд' &&
    newSlide.body.slide.cells?.length === 1 &&
    newSlide.body.slide.cells[0].slideId === newSlide.body.slide.id,
  newSlide.body,
);

const slidesAfterCreate = await req(`/api/memo-slides?blockId=${memoBlock.id}`, { token });
check(
  'GET /memo-slides -> карточки сгруппированы по слайдам',
  slidesAfterCreate.status === 200 &&
    slidesAfterCreate.body?.slides?.length === 2 &&
    slidesAfterCreate.body.slides.every((slide) => Array.isArray(slide.cells)),
  slidesAfterCreate.body?.slides?.map((slide) => `${slide.title}:${slide.cells.length}`),
);

const slideUpdated = await req(`/api/memo-slides/${newSlide.body.slide.id}`, {
  method: 'PUT',
  token,
  body: { title: 'Второй слайд' },
});
check(
  'PUT /memo-slides/:id сохраняет заголовок',
  slideUpdated.status === 200 && slideUpdated.body?.slide?.title === 'Второй слайд',
  slideUpdated.body,
);

const slidesReordered = await req('/api/memo-slides/reorder', {
  method: 'PUT',
  token,
  body: { blockId: memoBlock.id, orderedIds: [newSlide.body.slide.id, firstSlideId] },
});
check(
  'PUT /memo-slides/reorder -> новый слайд первым',
  slidesReordered.status === 200 && slidesReordered.body?.slides?.[0]?.id === newSlide.body.slide.id,
  slidesReordered.body?.slides?.map((slide) => slide.id),
);

const cellInSlide = await req('/api/memo-cells', {
  method: 'POST',
  token,
  body: { blockId: memoBlock.id, slideId: newSlide.body.slide.id, title: 'Третья карточка', body: 'Текст слайда' },
});
check(
  'POST /memo-cells с slideId кладёт карточку в слайд',
  cellInSlide.status === 201 && cellInSlide.body?.cell?.slideId === newSlide.body.slide.id,
  cellInSlide.body,
);

const deletedSlide = await req(`/api/memo-slides/${newSlide.body.slide.id}`, { method: 'DELETE', token });
const slideCardsLeft = await prisma.memoCell.count({ where: { slideId: newSlide.body.slide.id } });
check(
  'DELETE /memo-slides/:id удаляет карточки слайда',
  deletedSlide.status === 200 && slideCardsLeft === 0,
  { status: deletedSlide.status, slideCardsLeft },
);

const slideGuard = await req(`/api/memo-slides?blockId=${testBlock.id}`, { token });
check('GET /memo-slides чужого блока -> 400', slideGuard.status === 400, slideGuard.body);

// ===== глоссарий =====
const term1 = await req('/api/terms', {
  method: 'POST',
  token,
  body: { blockId: glossaryBlock.id, term: 'СИЗ', definition: docWithText('Средства индивидуальной защиты') },
});
check(
  'POST /terms -> 201 с определением',
  term1.status === 201 && docText(term1.body?.term?.definition).includes('Средства'),
  term1.body,
);

const termEmpty = await req('/api/terms', {
  method: 'POST',
  token,
  body: { blockId: glossaryBlock.id, term: '   ', definition: docWithText('Текст') },
});
check(
  'POST /terms с пустым термином -> 400 errors.term',
  termEmpty.status === 400 && Boolean(termEmpty.body?.errors?.term),
  termEmpty.body,
);

const termUpdated = await req(`/api/terms/${term1.body.term.id}`, {
  method: 'PUT',
  token,
  body: { term: '  СИЗ (средства)  ' },
});
check(
  'PUT /terms/:id обрезает пробелы',
  termUpdated.status === 200 && termUpdated.body?.term?.term === 'СИЗ (средства)',
  termUpdated.body,
);

const bulk = await req('/api/terms/bulk', {
  method: 'POST',
  token,
  body: {
    blockId: glossaryBlock.id,
    terms: [
      { term: 'Акт', definition: 'Документ проверки' },
      { term: 'Инструктаж', definition: docWithText('Обучение перед работой') },
      { term: 'Норма', definition: '' },
    ],
  },
});
check(
  'POST /terms/bulk -> 201, три термина',
  bulk.status === 201 &&
    bulk.body?.created === 3 &&
    bulk.body.terms.every((term) => term.definition?.version === 2) &&
    docText(bulk.body.terms[1].definition).includes('Обучение'),
  bulk.body,
);

const bulkBad = await req('/api/terms/bulk', {
  method: 'POST',
  token,
  body: {
    blockId: glossaryBlock.id,
    terms: [{ term: 'Акт', definition: 'Документ' }, { term: '   ', definition: 'Пусто' }],
  },
});
check(
  'POST /terms/bulk с пустой строкой -> 400 «Строка 2»',
  bulkBad.status === 400 && /Строка 2/.test(bulkBad.body?.errors?.terms ?? ''),
  bulkBad.body,
);

const termsList = await req(`/api/terms?blockId=${glossaryBlock.id}`, { token });
const totalTerms = termsList.body?.terms?.length;
check('GET /terms -> 4 термина', termsList.status === 200 && totalTerms === 4, termsList.body?.terms?.length);

const glossaryGuard = await req(`/api/terms?blockId=${memoBlock.id}`, { token });
check('GET /terms чужого блока -> 400', glossaryGuard.status === 400, glossaryGuard.body);

const deletedTerm = await req(`/api/terms/${term1.body.term.id}`, { method: 'DELETE', token });
check('DELETE /terms/:id -> 200', deletedTerm.status === 200, deletedTerm.body);

// ===== аудит =====
await new Promise((resolve) => setTimeout(resolve, 300));
const auditRows = await prisma.auditLog.findMany({
  where: { createdAt: { gte: startedAt }, entity: { in: ['Group', 'Question', 'MemoSlide', 'MemoCell', 'Term'] } },
  select: { entity: true, action: true, userId: true },
});

for (const entity of ['Group', 'Question', 'MemoSlide', 'MemoCell', 'Term']) {
  const rows = auditRows.filter((row) => row.entity === entity);
  check(`audit: ${entity} — есть create/update/delete`, rows.length >= 3, rows.map((row) => row.action));
}

check('audit: userId проставлен', auditRows.length > 0 && auditRows.every((row) => Boolean(row.userId)));

// ===== каскад =====
const cascade = await req(`/api/courses/${course.id}`, { method: 'DELETE', token });
const leftBlocks = await prisma.block.count({ where: { courseId: course.id } });
const leftQuestions = await prisma.testQuestion.count({ where: { blockId: testBlock.id } });
const leftCells = await prisma.memoCell.count({ where: { blockId: memoBlock.id } });
const leftMemoSlides = await prisma.memoSlide.count({ where: { blockId: memoBlock.id } });
const leftTerms = await prisma.glossaryTerm.count({ where: { blockId: glossaryBlock.id } });

check(
  'каскад: курс удаляет вопросы, карточки и термины',
  cascade.status === 200 && leftBlocks === 0 && leftQuestions === 0 && leftCells === 0 && leftMemoSlides === 0 && leftTerms === 0,
  { status: cascade.status, leftBlocks, leftQuestions, leftCells, leftMemoSlides, leftTerms },
);

// ===== очистка =====
await prisma.auditLog.deleteMany({
  where: {
    createdAt: { gte: startedAt },
    entity: { in: ['Group', 'Question', 'MemoSlide', 'MemoCell', 'Term', 'Block', 'Course'] },
  },
});
await prisma.course.deleteMany({ where: { title: 'Шаг 11: смоук' } });

const out = {
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
fs.writeFileSync('step11-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-step11: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((entry) => !entry.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;





