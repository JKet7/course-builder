// Проверки сборки справки о блоке (Правка 7): примечания и обратные ссылки.
// Чистые функции server/src/utils/help.js — сервер и БД не нужны.
//
// Запуск: node scripts/check-help.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HELP_COURSE_SELECT,
  blockUpdatedAt,
  buildBlockHelp,
  collectBlockMentions,
  collectBlockNotes,
  collectDocLinks,
  collectDocNotes,
  collectPlainLinks,
  collectPlainNotes,
} from '../src/utils/help.js';

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
};

/** Tiptap-документ из одной строки. */
const doc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Строка с примечанием (метка inlineNote, Правка 5). */
const notedDoc = (text, noteId, noteText) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, marks: [{ type: 'inlineNote', attrs: { noteId, text: noteText } }] }],
    },
  ],
});

/** Строка с внутренней ссылкой (метка link, Правка 6). */
const linkedDoc = (text, target) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text,
          marks: [
            {
              type: 'link',
              attrs: {
                href: `/block/${target.targetBlockId}?${target.targetType ?? 'slide'}=${target.targetId ?? ''}`,
                linkKind: 'internal',
                targetType: target.targetType ?? 'slide',
                targetId: target.targetId ?? '',
                targetBlockId: target.targetBlockId,
                targetLabel: target.targetLabel ?? '',
              },
            },
          ],
        },
      ],
    },
  ],
});

// --- Примечания и ссылки в одном документе ---------------------------------

const mixed = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Перед ' },
        { type: 'text', text: 'срок', marks: [{ type: 'inlineNote', attrs: { noteId: 'n1', text: '  Хранить\n три года  ' } }] },
      ],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'срок', marks: [{ type: 'inlineNote', attrs: { noteId: 'n1', text: 'Повтор' } }] }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'без', marks: [{ type: 'inlineNote', attrs: { noteId: '', text: 'без id' } }] }],
    },
  ],
};

const mixedNotes = collectDocNotes(mixed);
check('doc notes: found once per noteId', mixedNotes.length === 1, JSON.stringify(mixedNotes));
check('doc notes: whitespace collapsed', mixedNotes[0]?.text === 'Хранить три года', mixedNotes[0]?.text);
check('doc notes: empty noteId skipped', mixedNotes.every((note) => note.noteId !== ''));

const linksDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'внутренняя',
          marks: [
            {
              type: 'link',
              attrs: { linkKind: 'internal', targetBlockId: 'b2', targetType: 'memo', targetId: 'c1', targetLabel: 'Памятка' },
            },
          ],
        },
        { type: 'text', text: 'внешняя', marks: [{ type: 'link', attrs: { linkKind: 'external', href: 'https://example.com' } }] },
        { type: 'text', text: 'без цели', marks: [{ type: 'link', attrs: { linkKind: 'internal', href: '/block/b3' } }] },
      ],
    },
  ],
};
const docLinks = collectDocLinks(linksDoc);
check('doc links: only internal links with target block', docLinks.length === 1, JSON.stringify(docLinks));
check('doc links: target fields kept', docLinks[0]?.targetBlockId === 'b2' && docLinks[0]?.targetType === 'memo');

const plainNotes = collectPlainNotes({
  notes: [
    { id: 'p1', text: ' Примечание  поля ' },
    { id: 'p2', text: '' },
    { id: '', text: 'без id' },
    { id: 'p3', text: 'x'.repeat(400) },
  ],
});
check('plain notes: empty texts and ids dropped', plainNotes.length === 2, JSON.stringify(plainNotes.map((n) => n.noteId)));
check(
  'plain notes: text trimmed and clipped',
  plainNotes[0]?.text === 'Примечание поля' && plainNotes[1]?.text.endsWith('…'),
  plainNotes[1]?.text?.slice(-3),
);

const plainLinks = collectPlainLinks({
  links: [
    { id: 'l1', kind: 'internal', targetBlockId: 'b2', targetType: 'slide', targetId: 's1' },
    { id: 'l2', kind: 'external', href: 'https://example.com' },
    { id: 'l3', kind: 'internal' },
  ],
});
check('plain links: only internal links with target block', plainLinks.length === 1, JSON.stringify(plainLinks));

// --- Курс: блоки всех четырёх типов ---------------------------------------

const theoryBlock = {
  id: 't1',
  type: 'theory',
  title: 'Настройка системы',
  updatedAt: '2026-11-10T08:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'Введение',
      contents: [
        {
          id: 'c1',
          type: 'text',
          data: notedDoc('Ежегодно', 'n1', 'Проверка раз в год'),
          updatedAt: '2026-11-12T10:00:00.000Z',
        },
        {
          id: 'c2',
          type: 'table',
          data: {
            columns: 1,
            rows: 1,
            cells: [['Срок']],
            notes: [{ id: 'n2', text: 'Срок хранения', field: 'cell', ref: '0-0', from: 0, to: 4, word: 'Срок' }],
            links: [
              {
                id: 'l1',
                kind: 'internal',
                field: 'cell',
                ref: '0-0',
                from: 0,
                to: 4,
                word: 'Срок',
                targetType: 'memo',
                targetId: 'mc1',
                targetBlockId: 'm1',
              },
            ],
          },
        },
      ],
    },
    {
      id: 's2',
      title: 'Проверка',
      contents: [
        {
          id: 'c3',
          type: 'text',
          data: linkedDoc('памятка', { targetBlockId: 'm1', targetType: 'memo', targetId: 'mc1' }),
        },
      ],
    },
  ],
};

const memoBlock = {
  id: 'm1',
  type: 'memo',
  title: 'Памятка по охране труда',
  updatedAt: '2026-11-11T09:00:00.000Z',
  memoSlides: [
    {
      id: 'ms1',
      title: 'Слайд 1',
      cells: [
        {
          id: 'mc1',
          title: 'Сроки',
          titleDoc: notedDoc('Сроки', 'n11', 'Из приказа'),
          body: notedDoc('Срок', 'n10', 'Хранить три года'),
        },
        {
          id: 'mc2',
          title: 'Ссылка',
          titleDoc: linkedDoc('глоссарий', { targetBlockId: 'g1' }),
          body: linkedDoc('теория', { targetBlockId: 't1', targetType: 'slide', targetId: 's1' }),
        },
      ],
    },
  ],
};

const glossaryBlock = {
  id: 'g1',
  type: 'glossary',
  title: 'Глоссарий',
  updatedAt: '2026-11-09T09:00:00.000Z',
  terms: [
    { id: 'gterm1', term: 'Охрана труда', definition: notedDoc('система', 'n20', 'Набор мероприятий') },
    { id: 'gterm2', term: 'Инструктаж', definition: doc('Проводится при приёме') },
  ],
};

const testBlock = {
  id: 'q1',
  type: 'test',
  title: 'Тест по модулю 1',
  updatedAt: '2026-11-08T09:00:00.000Z',
  questions: [
    { id: 'qq1', explanation: notedDoc('проверка', 'n30', 'После инструктажа') },
    { id: 'qq2', explanation: linkedDoc('памятка', { targetBlockId: 'm1', targetType: 'memo', targetId: 'mc2' }) },
  ],
};

const unknownBlock = {
  id: 'x1',
  type: 'unknown',
  title: 'Неизвестный',
  updatedAt: '2026-11-01T09:00:00.000Z',
  slides: [{ id: 'sx', contents: [{ id: 'cx', type: 'text', data: notedDoc('x', 'nx', 'не должно попасть') }] }],
};

const course = {
  id: 'course-1',
  title: 'Охрана труда',
  blocks: [theoryBlock, memoBlock, glossaryBlock, testBlock, unknownBlock],
};

// --- Примечания и обратные ссылки по блокам --------------------------------

const theoryNotes = collectBlockNotes(theoryBlock);
check('notes (theory): two notes in document order', theoryNotes.length === 2, JSON.stringify(theoryNotes.map((n) => n.noteId)));
check(
  'notes (theory): places and hrefs',
  theoryNotes[0]?.place === 'слайд 1' &&
    theoryNotes[0]?.href === '/block/t1?slide=s1' &&
    theoryNotes[1]?.noteId === 'n2' &&
    theoryNotes[1]?.place === 'слайд 1',
  `${theoryNotes[0]?.place} ${theoryNotes[0]?.href}`,
);

const memoNotes = collectBlockNotes(memoBlock);
check(
  'notes (memo): title note first, then body note',
  memoNotes.length === 2 &&
    memoNotes[0].noteId === 'n11' &&
    memoNotes[0].place === 'слайд 1, карточка 1' &&
    memoNotes[0].href === '/block/m1?memo=mc1' &&
    memoNotes[1].noteId === 'n10' &&
    memoNotes[1].place === 'слайд 1, карточка 1',
  JSON.stringify(memoNotes),
);

const glossaryNotes = collectBlockNotes(glossaryBlock);
check(
  'notes (glossary): term place with name',
  glossaryNotes.length === 1 &&
    glossaryNotes[0].place === 'термин «Охрана труда»' &&
    glossaryNotes[0].href === '/block/g1?term=gterm1',
  JSON.stringify(glossaryNotes),
);

const testNotes = collectBlockNotes(testBlock);
check(
  'notes (test): only explanation notes',
  testNotes.length === 1 && testNotes[0].place === 'вопрос 1' && testNotes[0].href === '/block/q1?question=qq1',
  JSON.stringify(testNotes),
);

check('notes (unknown type): nothing collected', collectBlockNotes(unknownBlock).length === 0);

// Ячейки таблицы — Tiptap-документы: их примечания и ссылки тоже попадают в справку
const docTableBlock = {
  id: 't2',
  type: 'theory',
  title: 'Таблица документами',
  updatedAt: '2026-11-13T09:00:00.000Z',
  slides: [
    {
      id: 's3',
      title: 'Таблица',
      contents: [
        {
          id: 'c4',
          type: 'table',
          data: {
            columns: 2,
            rows: 1,
            headerRow: false,
            cells: [
              [
                notedDoc('Срок', 'n40', 'Из ГОСТ'),
                linkedDoc('памятка', { targetBlockId: 'm1', targetType: 'memo', targetId: 'mc1' }),
              ],
            ],
            merges: [],
          },
        },
      ],
    },
  ],
};

const docTableNotes = collectBlockNotes(docTableBlock);
check(
  'notes (table cells): примечание из документа ячейки',
  docTableNotes.length === 1 && docTableNotes[0].noteId === 'n40' && docTableNotes[0].place === 'слайд 1',
  JSON.stringify(docTableNotes),
);
check(
  'mentions (table cells): ссылка из документа ячейки',
  collectBlockMentions({ blocks: [docTableBlock] }, 'm1').length === 1,
  JSON.stringify(collectBlockMentions({ blocks: [docTableBlock] }, 'm1')),
);

const memoMentions = collectBlockMentions(course, 'm1');
check(
  'mentions: theory slides and test question',
  memoMentions.length === 3 &&
    memoMentions[0].blockId === 't1' &&
    memoMentions[0].place === 'слайд 1' &&
    memoMentions[1].place === 'слайд 2' &&
    memoMentions[2].blockId === 'q1' &&
    memoMentions[2].place === 'вопрос 2',
  JSON.stringify(memoMentions.map((item) => `${item.blockId}:${item.place}`)),
);
check(
  'mentions: href points to the mention place',
  memoMentions[0]?.href === '/block/t1?slide=s1' && memoMentions[2]?.href === '/block/q1?question=qq2',
  memoMentions[2]?.href,
);
check(
  'mentions: block title and type kept',
  memoMentions[0]?.blockTitle === 'Настройка системы' && memoMentions[0]?.blockType === 'theory',
);
check('mentions: self links are not counted', collectBlockMentions(course, 't1').every((item) => item.blockId !== 't1'));
check(
  'mentions: theory slide linked from memo cell',
  collectBlockMentions(course, 't1').some((item) => item.blockId === 'm1' && item.place === 'слайд 1, карточка 2'),
  JSON.stringify(collectBlockMentions(course, 't1').map((item) => `${item.blockId}:${item.place}`)),
);
check(
  'mentions: link from memo title is indexed',
  collectBlockMentions(course, 'g1').some((item) => item.blockId === 'm1' && item.place === 'слайд 1, карточка 2'),
  JSON.stringify(collectBlockMentions(course, 'g1').map((item) => `${item.blockId}:${item.place}`)),
);
check('mentions: unknown target gives empty list', collectBlockMentions(course, 'nope').length === 0);
check('mentions: unknown type block contributes nothing', collectBlockMentions(course, 'x1').length === 0);
check('mentions: course without blocks gives empty list', collectBlockMentions({}, 'm1').length === 0);

check(
  'updatedAt: max of block and content dates',
  blockUpdatedAt(theoryBlock) === '2026-11-12T10:00:00.000Z',
  blockUpdatedAt(theoryBlock),
);
check('updatedAt: block date for memo', blockUpdatedAt(memoBlock) === '2026-11-11T09:00:00.000Z');
check('updatedAt: null without dates', blockUpdatedAt({ id: 'b', type: 'memo' }) === null);

// --- Ответ для модалки -----------------------------------------------------

const help = buildBlockHelp(theoryBlock, course);
check('help: numbers are sequential', help.notes[0]?.number === 1 && help.notes[1]?.number === 2, JSON.stringify(help.notes));
check(
  'help: block info',
  help.block.id === 't1' && help.block.type === 'theory' && help.block.title === 'Настройка системы',
);
check('help: totals equal list lengths', help.totals.notes === 2 && help.totals.mentions === help.mentions.length);
check('help: mentions excluded self block', help.mentions.every((item) => item.blockId !== 't1'), JSON.stringify(help.mentions));
check('help: null block gives null', buildBlockHelp(null, course) === null);

const emptyHelp = buildBlockHelp({ id: 'empty', type: 'theory', title: 'Пусто', slides: [] }, { blocks: [] });
check(
  'help: empty block keeps sections empty',
  emptyHelp.notes.length === 0 && emptyHelp.mentions.length === 0 && emptyHelp.totals.notes === 0,
);

const longHelp = buildBlockHelp(
  {
    id: 'long',
    type: 'theory',
    title: 'Длинный',
    slides: [{ id: 'sl', contents: [{ id: 'cl', data: notedDoc('слово', 'nlong', 'я'.repeat(400)) }] }],
  },
  { blocks: [] },
);
check(
  'help: long note text clipped',
  longHelp.notes[0]?.text.length === 300 && longHelp.notes[0].text.endsWith('…'),
  String(longHelp.notes[0]?.text.length),
);

check(
  'select: course blocks include all four content kinds',
  Boolean(
    HELP_COURSE_SELECT.blocks.select.slides.select.contents.select.data &&
      HELP_COURSE_SELECT.blocks.select.questions.select.explanation &&
      HELP_COURSE_SELECT.blocks.select.memoSlides.select.cells.select.body &&
      HELP_COURSE_SELECT.blocks.select.memoSlides.select.cells.select.titleDoc &&
      HELP_COURSE_SELECT.blocks.select.terms.select.definition &&
      HELP_COURSE_SELECT.blocks.select.updatedAt,
  ),
);

const failed = results.filter((item) => !item.ok);

// Подробный отчёт пишем файлом: консоль Windows ломает кириллицу.
const reportPath = join(tmpdir(), 'check-help-report.txt');
const report = results
  .map((item) => `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `\n        ${item.detail}` : ''}`)
  .join('\n');
writeFileSync(reportPath, `${report}\n\n${results.length - failed.length}/${results.length} проверок пройдено\n`, 'utf8');

for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok || !item.detail ? '' : ` (${item.detail})`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`Отчёт: ${reportPath}`);
process.exitCode = failed.length ? 1 : 0;
