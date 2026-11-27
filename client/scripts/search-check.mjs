/**
 * Шаг 17: проверка поиска по документу.
 *
 * Юнит-проверки `utils/search.js` — модуль чистый (без React), поэтому Node
 * выполняет его напрямую. Плюс статические проверки панели `DocumentSearch`,
 * интеграции в `TheoryBlock`/`SlideGrid`, стилей и README.
 *
 * Запуск: node scripts/search-check.mjs
 */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  SEARCH_LIMIT,
  SEARCH_MIN_QUERY,
  getContentSearchFields,
  makeSnippet,
  normalizeSearchQuery,
  normalizeSearchText,
  searchSlides,
} from '../src/utils/search.js';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const docWith = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const slides = [
  {
    id: 'slide-1',
    title: 'Введение',
    contents: [
      { id: 'c-text', type: 'text', data: docWith('Правила охраны труда'), width: 100 },
      {
        id: 'c-table',
        type: 'table',
        data: { columns: 2, rows: 2, cells: [['Срок', 'Значение'], ['Проверка', 'Раз в год']], headerRow: true },
        width: 50,
      },
    ],
  },
  {
    id: 'slide-2',
    title: 'Ёмкости и жидкости',
    contents: [
      {
        id: 'c-checklist',
        type: 'checklist',
        data: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: 'Слить жидкость', checked: false }] },
        width: 100,
      },
      {
        id: 'c-code',
        type: 'code',
        data: { language: 'javascript', filename: 'rules.js', code: 'const rules = [];' },
        width: 50,
      },
      {
        id: 'c-replica',
        type: 'replica',
        data: { character: 'Инспектор', side: 'left', text: 'Проверьте срок' },
        width: 50,
      },
      {
        id: 'c-image',
        type: 'image',
        data: { fileId: null, url: '/uploads/a.png', alt: 'Схема эвакуации', caption: 'План Б', width: 100, align: 'center' },
        width: 33,
      },
      {
        id: 'c-video',
        type: 'video',
        data: { url: 'https://youtu.be/abc', caption: 'Инструктаж по ёмкостям' },
        width: 66,
      },
    ],
  },
  { id: 'slide-3', title: '', contents: [] },
];

const found = (query, options) => searchSlides(slides, query, options);
const ids = (query, options) => found(query, options).results.map((result) => result.contentId);

// 1. Нормализация запроса и текста
check('запрос: регистр и лишние пробелы', normalizeSearchQuery('  ПРАВИЛА   охраны ') === 'правила охраны');
check('запрос: «ё» приравнивается к «е»', normalizeSearchQuery('Ёмкости') === 'емкости');
check('текст: нормализация «ё» без изменения длины', normalizeSearchText('ЁЖ').length === 2);
check('минимальная длина запроса — 2 символа', SEARCH_MIN_QUERY === 2);


// 2. Текстовые поля по типам фрагментов
const textFields = getContentSearchFields({ type: 'text', data: docWith('Текст теории') });
check('поле: текст Tiptap-документа', textFields.length === 1 && textFields[0].text === 'Текст теории');

const tableFields = getContentSearchFields({ type: 'table', data: slides[0].contents[1].data });
check('поле: ячейки таблицы', tableFields[0].text.includes('Раз в год'));

const imageFields = getContentSearchFields({ type: 'image', data: slides[1].contents[3].data });
check(
  'поле: alt и подпись картинки',
  imageFields[0].text.includes('эвакуации') && imageFields[0].text.includes('План Б'),
);

const checklistFields = getContentSearchFields({ type: 'checklist', data: slides[1].contents[0].data });
check('поле: заголовок и пункты чек-листа', checklistFields[0].text.includes('Слить жидкость'));

check('поле: неизвестный тип ничего не отдаёт', getContentSearchFields({ type: 'webinar', data: {} }).length === 0);
check('поле: фрагмент без типа не падает', getContentSearchFields(null).length === 0);

const brokenText = getContentSearchFields({ type: 'text', data: null })[0];
check('поле: пустой Tiptap-документ даёт пустую строку', brokenText.text === '');

// 3. Поиск по слайдам и фрагментам
check('поиск: текст фрагмента', ids('охраны').includes('c-text'));
check('поиск: ячейка таблицы', ids('раз в год').includes('c-table'));
check('поиск: пункт чек-листа', ids('слить').includes('c-checklist'));
check('поиск: имя файла и код', ids('rules.js').includes('c-code') && ids('const rules').includes('c-code'));
check('поиск: персонаж реплики', ids('инспектор').includes('c-replica'));
check('поиск: alt картинки', ids('эвакуации').includes('c-image'));
check('поиск: подпись видео', ids('инструктаж').includes('c-video'));

const titleMatch = found('введение').results[0];
check(
  'поиск: название слайда — отдельный результат',
  titleMatch?.contentType === 'slide' && titleMatch?.contentId === null && titleMatch?.contentLabel === 'Слайд',
);

const yoMatches = found('емкост');
check(
  'поиск: «е» в запросе находит «Ё»',
  yoMatches.total >= 2 &&
    yoMatches.results.some((result) => result.contentType === 'slide') &&
    yoMatches.results.some((result) => result.contentType === 'video'),
  `${yoMatches.total} совпадений`,
);

check('поиск: один символ не ищется', found('о').total === 0);
check('поиск: пустой запрос', found('   ').total === 0);
check('поиск: нет совпадений', found('вертолёт').results.length === 0 && found('вертолёт').total === 0);

// 4. Порядок, сниппеты, лимит
const ordered = found('провер').results;
check(
  'поиск: результаты идут по порядку слайдов',
  ordered.length >= 2 && ordered[0].slideIndex <= ordered[1].slideIndex,
  ordered.map((result) => `${result.slideIndex}:${result.contentLabel}`).join(' → '),
);

check(
  'поиск: номер слайда и его название в результате',
  ordered[0].slideIndex === 0 && ordered[0].slideTitle === 'Введение',
);

check('поиск: уникальные ключи результатов', new Set(ordered.map((result) => result.key)).size === ordered.length);

const snippet = makeSnippet('Правила охраны труда и промышленной безопасности на предприятии', 'охраны');
check(
  'сниппет: совпадение выделено в исходном регистре',
  snippet.match === 'охраны' && snippet.before.endsWith('Правила '),
  JSON.stringify(snippet),
);

const longSnippet = makeSnippet(`${'а'.repeat(120)} игла ${'б'.repeat(120)}`, 'игла');
check(
  'сниппет: длинный текст обрезан с многоточием',
  longSnippet.before.startsWith('…') && longSnippet.after.endsWith('…'),
  JSON.stringify(longSnippet),
);

check('сниппет: пустой текст — null', makeSnippet('   ', 'игла') === null);

const repeated = searchSlides(
  [{ id: 's', title: '', contents: [{ id: 'd', type: 'text', data: docWith('правила и правила') }] }],
  'правила',
);
check('поиск: строка на фрагмент, а не на каждое вхождение', repeated.total === 1, `${repeated.total} совпадений`);

const wideSlides = Array.from({ length: 5 }, (_, index) => ({
  id: `wide-${index}`,
  title: `Слайд ${index}`,
  contents: [{ id: `wide-content-${index}`, type: 'text', data: docWith('проверка') }],
}));

const limited = searchSlides(wideSlides, 'проверка', { limit: 2 });
check(
  'поиск: limit ограничивает выдачу, total — нет',
  limited.results.length === 2 && limited.total === 5,
  `${limited.results.length} из ${limited.total}`,
);
check('поиск: лимит по умолчанию объявлен', SEARCH_LIMIT >= 20);

const withNulls = searchSlides(
  [{ id: 's', title: 'Слайд', contents: [null, { id: 'c', type: 'text', data: null }] }, null],
  'слайд',
);
check('поиск: пустые слайды и фрагменты не ломают проход', withNulls.total === 1);


// 5. Статические проверки панели, интеграции, стилей и документации
const panel = read('src/components/editor/DocumentSearch.jsx');
const theory = read('src/components/editor/TheoryBlock.jsx');
const grid = read('src/components/content/ContentGrid.jsx');
const globals = read('src/styles/globals.css');
const readme = read('../README.md');
const pkg = JSON.parse(read('package.json'));

check(
  'панель: поле, список результатов и подсветка совпадения',
  panel.includes('doc-search__input') && panel.includes('doc-search__list') && panel.includes('doc-search__match'),
);
check(
  'панель: доступность списка',
  panel.includes('role="listbox"') &&
    panel.includes('role="option"') &&
    panel.includes('aria-label={ariaLabel}') &&
    panel.includes("ariaLabel = 'Найти в теории'"),
);
check(
  'панель: клавиатура — стрелки, Enter и Esc',
  panel.includes('ArrowDown') && panel.includes('ArrowUp') && panel.includes('Enter') && panel.includes("'Escape'"),
);
check('панель: подсказка про минимум символов', panel.includes('SEARCH_MIN_QUERY'));
check('панель: счётчик совпадений', panel.includes('pluralize') && panel.includes('doc-search__count'));

check(
  'теория: Ctrl+F и Cmd+F открывают поиск',
  theory.includes("event.key.toLowerCase() === 'f'") && theory.includes('metaKey') && theory.includes('preventDefault'),
);
check('теория: Esc закрывает панель', theory.includes("event.key === 'Escape'") && theory.includes('setSearchOpen(false)'));
check('теория: прокрутка к найденному фрагменту', theory.includes('data-content-id') && theory.includes('scrollIntoView'));
check(
  'теория: панель и кнопка встроены в блок',
  theory.includes('DocumentSearch') && theory.includes('Поиск по документу'),
);
check('теория: подсветка передаётся в сетку слайда', theory.includes('highlightContentId={foundContentId}'));

check(
  'слайд: карточка помечена data-content-id',
  grid.includes('data-content-id={content.id}') && grid.includes('content-card--found'),
);

// Та же сетка у слайдов памятки и карточек глоссария: все типы контента в одном месте
const termCard = read('src/components/glossary/TermCard.jsx');
const memoCard = read('src/components/memo/MemoCard.jsx');
const memoSlide = read('src/components/memo/MemoSlide.jsx');
const contentBody = read('src/utils/contentBody.js');
check(
  'карточки: глоссарий и памятка используют общую сетку контента',
  termCard.includes('ContentGrid') && memoCard.includes('ContentGrid') && contentBody.includes('CONTENT_BODY_VERSION'),
);

// Панель инструментов блока применяет команды к тому текстовому фрагменту
// карточки, где стоит курсор: TiptapEditor сообщает о фокусе в editorStore,
// а блоки глоссария и памятки берут оттуда activeEditor для своего Toolbar.
const tiptap = read('src/components/editor/TiptapEditor.jsx');
const glossaryBlock = read('src/components/editor/GlossaryBlock.jsx');
const memoBlock = read('src/components/editor/MemoBlock.jsx');
check(
  'карточки: панель инструментов форматирует текст в глоссарии и памятке',
  grid.includes('ContentEditor') &&
    tiptap.includes('setActiveEditor(editor)') &&
    glossaryBlock.includes('state.activeEditor') &&
    memoBlock.includes('state.activeEditor') &&
    glossaryBlock.includes('<Toolbar editor={activeEditor} />') &&
    memoBlock.includes('<Toolbar editor={activeEditor} />'),
);

check(
  'памятка: слайд с сеткой карточек, содержание и поиск — как в теории',
  memoBlock.includes('MemoSlide') &&
    memoBlock.includes('slide-list') &&
    memoBlock.includes('DocumentSearch') &&
    memoSlide.includes('memo-grid') &&
    memoSlide.includes('MemoCard') &&
    memoCard.includes('ContentGrid') &&
    memoBlock.includes('highlightContentId={foundContentId}'),
);

check(
  'памятка: заголовок карточки — форматируемый Tiptap и разделитель',
  memoCard.includes('TiptapEditor') &&
    memoCard.includes('titleDoc') &&
    memoCard.includes('memo-card__divider') &&
    memoCard.includes('memoTitleDoc'),
);

check(
  'стили: панель, подсветка и найденная карточка',
  globals.includes('.doc-search {') && globals.includes('.doc-search__match') && globals.includes('.content-card--found'),
);

// Телефонные правила ищем в любом блоке 640px: после Правки 5 в конце файла появился
// ещё один такой блок, поэтому «последний» уже не обязательно про поиск.
const phoneBlocks = globals.split('@media (max-width: 640px)').slice(1);
check(
  'стили: панель адаптируется на телефоне',
  phoneBlocks.some((block) => block.includes('.doc-search__snippet')),
);

check('документация: раздел Шага 17', readme.includes('## Шаг 17: поиск по документу'));
check('документация: проверка в списке', readme.includes('check:search'));
check('npm: скрипт check:search', pkg.scripts?.['check:search'] === 'node scripts/search-check.mjs');

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

// Отчёт файлом: консоль Windows ломает кириллицу при перенаправлении.
await writeFile(
  new URL('../search-check.json', import.meta.url),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;

