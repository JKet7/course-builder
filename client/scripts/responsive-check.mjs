/**
 * Шаг 16: статическая проверка адаптивности.
 *
 * Читает index.html и CSS (globals.css, print.css) и проверяет, что у каждой
 * сетки есть правило для планшета (900), телефона (640) и узкого телефона
 * (480): сетки сводятся к одной колонке, указатель глоссария уходит в
 * горизонтальный скролл, длинные строки не растягивают страницу.
 *
 * Запуск: node scripts/responsive-check.mjs
 */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const html = read('index.html');
const globals = read('src/styles/globals.css');
const print = read('src/styles/print.css');
const glossarySource = read('src/components/editor/GlossaryBlock.jsx');
const printSource = read('src/pages/PrintCoursePage.jsx');

/** Все @media-блоки файла: { query, body }. Вложенных @media в стилях нет. */
function mediaBlocks(css) {
  const blocks = [];
  let from = 0;

  for (;;) {
    const at = css.indexOf('@media', from);
    if (at === -1) break;

    const open = css.indexOf('{', at);
    if (open === -1) break;

    let depth = 1;
    let index = open + 1;

    while (index < css.length && depth > 0) {
      const char = css[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      index += 1;
    }

    blocks.push({ query: css.slice(at + 6, open).trim(), body: css.slice(open + 1, index - 1) });
    from = index;
  }

  return blocks;
}

/** Склеенное тело всех блоков с указанной максимальной шириной. */
const atWidth = (blocks, width) =>
  blocks
    .filter((block) => block.query.includes(`max-width: ${width}px`))
    .map((block) => block.body)
    .join('\n');

/** Тело первого правила с точным селектором или null. */
function rule(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return null;

  const end = css.indexOf('}', at);
  return end === -1 ? null : css.slice(at + selector.length + 2, end).trim();
}

/** Значение свойства в теле правила или null. */
function valueOf(body, property) {
  if (!body) return null;

  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    if (part.slice(0, colon).trim() === property) return part.slice(colon + 1).trim();
  }

  return null;
}

/** Есть ли свойство с ожидаемым значением (подстрокой). */
function has(body, property, expected) {
  const value = valueOf(body, property);
  return value !== null && value.includes(expected);
}

const globalsMedia = mediaBlocks(globals);
const printMedia = mediaBlocks(print);

const tablet = atWidth(globalsMedia, 900);
const phone = atWidth(globalsMedia, 640);
const narrow = atWidth(globalsMedia, 480);

// 1. Основа: мобильный viewport и все три брейкпоинта
check(
  'viewport: страница масштабируется по ширине устройства',
  html.includes('name="viewport"') && html.includes('width=device-width'),
);

for (const width of [900, 640, 480]) {
  check(
    `брейкпоинт ${width}px объявлен`,
    globalsMedia.some((block) => block.query.includes(`max-width: ${width}px`)),
    globalsMedia.map((block) => block.query).join(' | '),
  );
}

// 2. Сетки: одна колонка на своей ширине
const gridColumns = [
  ['теория: контент и панель слайдов', tablet, '.theory__layout'],
  ['тест: панель групп над вопросами', tablet, '.test-layout'],
  ['глоссарий: указатель над терминами', tablet, '.glossary-layout'],
  ['курсы: карточки в одну колонку', phone, '.course-grid'],
  ['курс: список блоков и превью в одну колонку', tablet, '.course-layout'],
  ['памятка: слайд и содержание в одну колонку', tablet, '.memo-layout'],
  ['памятка: карточки слайда в одну колонку', phone, '.memo-grid'],
];

/** Одна колонка: `1fr` или `minmax(0, 1fr)`, но не `repeat(...)`. */
function isOneColumn(body) {
  const value = valueOf(body, 'grid-template-columns');
  return value !== null && value.includes('1fr') && !value.includes('repeat(');
}

for (const [name, scope, selector] of gridColumns) {
  const body = rule(scope, selector);
  check(
    `сетка — ${name}`,
    isOneColumn(body),
    body === null ? `правило ${selector} не найдено` : `grid-template-columns: ${valueOf(body, 'grid-template-columns')}`,
  );
}

check(
  'памятка: на планшете содержание уходит под слайд',
  has(rule(tablet, '.memo__side'), 'position', 'static'),
  rule(tablet, '.memo__side'),
);

check(
  'чек-лист: две колонки складываются в одну',
  has(rule(phone, '.content-checklist--two .content-checklist__list'), 'grid-template-columns', 'minmax(0, 1fr)'),
);

// Ряд слайда — сетка: на телефоне одна колонка, блок 33 % занимает всю ширину
check(
  'слайд: ряды становятся колонкой',
  isOneColumn(rule(phone, '.slide-row')),
  valueOf(rule(phone, '.slide-row'), 'grid-template-columns'),
);

check(
  'слайд: блок 33 % на телефоне на всю ширину',
  has(rule(phone, '.content-card'), 'grid-column', '1 / -1'),
  valueOf(rule(phone, '.content-card'), 'grid-column'),
);

check('панель инструментов: горизонтальная прокрутка', has(rule(phone, '.toolbar'), 'overflow-x', 'auto'));

// 3. Глоссарий: указатель по буквам (сайдбар → горизонтальный скролл)
const lettersBase = rule(globals, '.glossary-letters');
const lettersTablet = rule(tablet, '.glossary-letters');

check(
  'глоссарий: указатель — колонка и sticky на десктопе',
  has(lettersBase, 'flex-direction', 'column') && has(lettersBase, 'position', 'sticky'),
  lettersBase,
);

check(
  'глоссарий: на планшете указатель — строка с горизонтальным скроллом',
  has(lettersTablet, 'flex-direction', 'row') && has(lettersTablet, 'overflow-x', 'auto'),
  lettersTablet,
);

check(
  'глоссарий: раскладка «указатель + термины»',
  has(rule(globals, '.glossary-layout'), 'grid-template-columns', '40px'),
);

check(
  'глоссарий: одна колонка, когда букв нет',
  has(rule(globals, '.glossary-layout--plain'), 'grid-template-columns', 'minmax(0, 1fr)'),
);

check(
  'глоссарий: разметка указателя в компоненте',
  glossarySource.includes('glossary-letters') &&
    glossarySource.includes('glossary-letter') &&
    glossarySource.includes('glossary-groups') &&
    glossarySource.includes('scrollIntoView'),
);

check(
  'глоссарий: поиск занимает строку целиком на телефоне',
  has(rule(phone, '.glossary-search .input'), 'width', 'auto') &&
    has(rule(phone, '.glossary-search .input'), 'flex', '1'),
);

// 4. Шапка приложения на телефоне
check('шапка: роль скрыта на телефоне', has(rule(phone, '.app-header__role'), 'display', 'none'));

check(
  'шапка: логин обрезается на узком экране',
  has(rule(narrow, '.app-header__user'), 'text-overflow', 'ellipsis'),
);

// 5. Закрепление шапки и панелей содержания
const headerSource = read('src/components/layout/Header.jsx');
const headerRule = rule(globals, '.app-header');

check(
  'шапка: закреплена вверху окна',
  has(headerRule, 'position', 'sticky') && valueOf(headerRule, 'top') === '0',
  headerRule,
);

const headerZ = Number(valueOf(headerRule, 'z-index'));

check(
  'шапка: выше контента и панели инструментов, ниже модалок',
  headerZ > 20 && headerZ < 100,
  `z-index: ${headerZ}`,
);

check(
  'шапка: высоту измеряет Header и пишет в --app-header-h',
  headerSource.includes('ResizeObserver') &&
    headerSource.includes("setProperty('--app-header-h'") &&
    globals.includes('--app-header-h: 64px'),
);

const stickyPanels = [
  ['теория: содержание', '.theory__side'],
  ['тест: группы вопросов', '.test-side'],
  ['курс: список блоков', '.course-layout__side'],
  ['курс: превью блока', '.course-layout__preview'],
  ['глоссарий: указатель букв', '.glossary-letters'],
  ['редактор: панель инструментов', '.toolbar'],
];

for (const [name, selector] of stickyPanels) {
  const body = rule(globals, selector);
  check(
    `закреплено — ${name}`,
    has(body, 'position', 'sticky') && String(valueOf(body, 'top')).includes('var(--app-header-h)'),
    body,
  );
}

// Тулбар идёт во всю ширину над содержанием, поэтому его высота входит в отступ
// панелей: иначе при прокрутке он перекрывает верх «Содержания».
const toolbarSource = read('src/components/editor/toolbar/Toolbar.jsx');

check(
  'панель инструментов: высоту измеряет Toolbar и пишет в --toolbar-h',
  toolbarSource.includes("setProperty('--toolbar-h'") &&
    toolbarSource.includes("removeProperty('--toolbar-h')") &&
    globals.includes('--toolbar-h: 0px'),
);

check(
  'содержание не уезжает под панель инструментов',
  ['.theory__side', '.test-side', '.glossary-letters'].every((selector) =>
    String(valueOf(rule(globals, selector), 'top')).includes('var(--toolbar-h)'),
  ),
);

const sideRule = rule(globals, '.theory__side');

check(
  'содержание: прокручивается внутри закреплённой панели',
  has(sideRule, 'max-height', '100vh') && has(sideRule, 'overflow-y', 'auto'),
  sideRule,
);

check(
  'планшет: закрепление панелей снято, они идут в общем потоке',
  has(rule(atWidth(globalsMedia, 900), '.theory__side'), 'position', 'static') &&
    has(rule(atWidth(globalsMedia, 900), '.test-side'), 'position', 'static') &&
    has(rule(atWidth(globalsMedia, 900), '.course-layout__side'), 'position', 'static'),
);

const headerMargins =
  globals.match(/scroll-margin-top: calc\(var\(--app-header-h\) \+ var\(--toolbar-h\) \+ 16px\)/g) ?? [];

check(
  'внутренние переходы: цель не прячется под шапкой и тулбаром',
  headerMargins.length >= 2 && globals.includes('[data-content-id],'),
  `scroll-margin-top с var(--app-header-h) и var(--toolbar-h): ${headerMargins.length}`,
);

// 6. Медиа и длинные строки не создают горизонтальный скролл
const mediaRule = (() => {
  let at = globals.indexOf('iframe {');

  while (at !== -1) {
    if (globals.slice(Math.max(0, at - 40), at).includes('video,')) {
      const end = globals.indexOf('}', at);
      return end === -1 ? null : globals.slice(at + 8, end).trim();
    }

    at = globals.indexOf('iframe {', at + 1);
  }

  return null;
})();
check('картинки и видео не шире контейнера', has(mediaRule, 'max-width', '100%'), mediaRule);

const bodyRule = rule(globals, 'body');
check(
  'body без overflow-x: hidden — sticky-панели продолжают работать',
  bodyRule !== null && !bodyRule.includes('overflow-x'),
  bodyRule,
);

const minWidths = [...globals.matchAll(/min-width: (\d+)px/g)].map((match) => Number(match[1]));
const wide = minWidths.filter((value) => value > 320);
check('нет min-width больше 320px', wide.length === 0, wide.join(', ') || 'ок');

// Окно настройки многоуровневого списка (Правка 4): 9 уровней прокручиваются по горизонтали
const listLevelsRule = rule(globals, '.list-levels');
const listRowRule = rule(globals, '.list-levels__row');
check(
  'списки: таблица уровней прокручивается, а не ломает окно',
  has(listLevelsRule, 'overflow-x', 'auto') && has(listRowRule, 'min-width', '100%'),
  `${listLevelsRule} | ${listRowRule}`,
);

// 7. Печатная версия на узком экране
const printTablet = atWidth(printMedia, 900);
const printPhone = atWidth(printMedia, 640);

check('печать: страница A4', print.includes('size: A4'));
check('печать: правила @media print на месте', print.includes('@media print'));

check(
  'печать: на планшете поля документа уже',
  has(rule(printTablet, '.print-doc'), 'padding', '32px 28px'),
  rule(printTablet, '.print-doc'),
);

check(
  'печать: ряды слайда в колонку',
  isOneColumn(rule(printPhone, '.print-row')),
  rule(printPhone, '.print-row'),
);

check(
  'печать: фрагмент занимает всю ширину',
  has(rule(printPhone, '.print-cell'), 'grid-column', '1 / -1'),
  rule(printPhone, '.print-cell'),
);

check(
  'печать: оболочка без широких полей',
  has(rule(printPhone, '.print-app'), 'padding', '12px 8px 40px'),
  rule(printPhone, '.print-app'),
);

check(
  'печать: разметка использует print-row и print-cell',
  printSource.includes('print-row') && printSource.includes('print-cell'),
);

// Правка 3: панель инструментов закреплена сверху, как в Word
const toolbarRule = rule(globals, '.toolbar');

check(
  'панель инструментов: закреплена при прокрутке',
  has(toolbarRule, 'position', 'sticky') && valueOf(toolbarRule, 'top') !== null,
  toolbarRule,
);

check(
  'панель инструментов: подсказка без активного поля',
  has(rule(globals, '.toolbar__hint'), 'margin-left', 'auto'),
  rule(globals, '.toolbar__hint'),
);

// Правка 5: поле примечания не вылезает за экран, подсказка читается на телефоне
const notePopoverRule = rule(globals, '.note-popover');

check(
  'примечания: поле ограничено шириной экрана',
  has(notePopoverRule, 'max-width', 'calc(100vw - 24px)'),
  notePopoverRule,
);

const phoneMedia = atWidth(globalsMedia, 640);

check(
  'примечания: на телефоне поле и подсказка по ширине экрана',
  phoneMedia.includes('.note-popover') && phoneMedia.includes('left: 12px !important') && phoneMedia.includes('.note-tip'),
);

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

// Отчёт файлом: консоль Windows ломает кириллицу при перенаправлении.
await writeFile(
  new URL('../responsive-check.json', import.meta.url),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;
