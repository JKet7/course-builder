import { normalizeTableData, TABLE_LIMITS } from './table.js';
import { normalizeDialogData } from './dialog.js';
import { normalizeImportantStyle } from './important.js';

/**
 * Настройки диалога (бывшая «Реплика») — в utils/dialog.js.
 * Здесь они реэкспортируются, чтобы редакторы импортировали всё из helpers.
 */
export {
  DIALOG_COLOR_FALLBACK,
  DIALOG_FOCUS_DEFAULT,
  DIALOG_FOCUS_POINTS,
  DIALOG_LIMITS,
  DIALOG_POSITIONS,
  DIALOG_SIDES,
  DIALOG_TAILS,
  DIALOG_TEXT_ALIGNS,
  DIALOG_ZOOM_DEFAULT,
  DIALOG_ZOOM_STEP,
  createDialogLine,
  dialogAvatarStyle,
  getDialogInitial,
  getDialogLineLayout,
  getDialogTail,
  normalizeDialogColor,
  normalizeDialogData,
  normalizeDialogFocus,
  normalizeDialogZoom,
} from './dialog.js';


/** Дата в формате 11.11.2026 (для карточек курсов/блоков). */
export function formatDate(value, locale = 'ru-RU') {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Русская форма множественного числа: pluralize(3, ['блок', 'блока', 'блоков']) → 'блоков'. */
export function pluralize(count, forms) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const BLOCK_BADGE_COLORS = {
  theory: 'badge--blue',
  test: 'badge--green',
  memo: 'badge--orange',
  glossary: 'badge--purple',
};

/** CSS-класс бейджа по типу блока. */
export function getBlockBadgeColor(type) {
  return BLOCK_BADGE_COLORS[type] ?? 'badge--gray';
}

/** Допустимые типы блоков (совпадает с server/src/controllers/blockController.js). */
export const BLOCK_TYPES = ['theory', 'test', 'memo', 'glossary'];

const BLOCK_TYPE_LABELS = {
  theory: 'Теория',
  test: 'Тест',
  memo: 'Памятка',
  glossary: 'Глоссарий',
};

/** Название типа блока для интерфейса. */
export function getBlockTypeLabel(type) {
  return BLOCK_TYPE_LABELS[type] ?? 'Блок';
}

const BLOCK_TYPE_ICONS = {
  theory: 'file',
  test: 'clipboard',
  memo: 'layers',
  glossary: 'book',
};

/** Иконка типа блока (имя из ui/Icon.jsx). */
export function getBlockIcon(type) {
  return BLOCK_TYPE_ICONS[type] ?? 'layers';
}

const BLOCK_CONTENT_FORMS = {
  theory: ['слайд', 'слайда', 'слайдов'],
  test: ['вопрос', 'вопроса', 'вопросов'],
  memo: ['слайд', 'слайда', 'слайдов'],
  glossary: ['термин', 'термина', 'терминов'],
};

/** «3 слайда» / «5 вопросов» — подпись содержимого блока по его типу. */
export function getBlockContentLabel(type, count) {
  const forms = BLOCK_CONTENT_FORMS[type];
  const value = Number(count) || 0;
  if (!forms) return String(value);
  return `${value} ${pluralize(value, forms)}`;
}

/**
 * Типы фрагментов контента слайда (совпадает с list типов на сервере,
 * см. server/src/utils/content.js). Порядок = порядок в меню «Добавить контент».
 */
export const CONTENT_TYPES = [
  { type: 'text', label: 'Текст', icon: 'type', hint: 'Форматированный текст' },
  { type: 'table', label: 'Таблица', icon: 'table', hint: 'Данные в ячейках' },
  { type: 'image', label: 'Картинка', icon: 'image', hint: 'Иллюстрация с подписью' },
  { type: 'video', label: 'Видео', icon: 'video', hint: 'Файл или ссылка YouTube/Vimeo' },
  { type: 'important', label: 'Важное', icon: 'alert', hint: 'Выделенный блок' },
  { type: 'checklist', label: 'Чек-лист', icon: 'checklist', hint: 'Список пунктов' },
  { type: 'code', label: 'Код', icon: 'code', hint: 'Фрагмент кода' },
  { type: 'replica', label: 'Диалог', icon: 'replica', hint: 'Реплики персонажей' },
];

/** Допустимые ширины колонки в ряду (совпадает с сервером). */
export const CONTENT_WIDTHS = [33, 50, 66, 100];

const CONTENT_TYPE_BY_NAME = new Map(CONTENT_TYPES.map((item) => [item.type, item]));

/** Метаданные типа контента: { type, label, icon, hint }. */
export function getContentType(type) {
  return CONTENT_TYPE_BY_NAME.get(type) ?? { type, label: 'Контент', icon: 'layers', hint: '' };
}

/** Название типа контента для подписи карточки. */
export function getContentTypeLabel(type) {
  return getContentType(type).label;
}

/**
 * Строки слайда: до 3 колонок, пока сумма ширин не превысит 100%.
 * [{ items: [content, ...], used: 99 }, ...]
 */
export function buildContentRows(contents = []) {
  const rows = [];
  let current = { items: [], used: 0 };

  for (const content of contents) {
    const width = Number(content.width) || 100;

    if (current.items.length > 0 && current.used + width > 100) {
      rows.push(current);
      current = { items: [], used: 0 };
    }

    current.items.push(content);
    current.used += width;

    if (current.used >= 100) {
      rows.push(current);
      current = { items: [], used: 0 };
    }
  }

  if (current.items.length > 0) rows.push(current);
  return rows;
}

/** Колонок в ряду слайда: 100 % ширины = 12 колонок сетки. */
export const CONTENT_ROW_COLUMNS = 12;

/**
 * Ширина автора (33 / 50 / 66 / 100 %) → число колонок сетки ряда.
 * 33 % → 4, 50 % → 6, 66 % → 8, 100 % → 12.
 */
export function contentSpan(width) {
  const value = Number(width) || 100;
  const span = Math.round((value / 100) * CONTENT_ROW_COLUMNS);
  return Math.min(CONTENT_ROW_COLUMNS, Math.max(1, span));
}

/**
 * Колонки для блоков ряда.
 *
 * Раньше ширину задавал flexBasis: проценты не учитывали gap, и три блока по
 * 33 % (99 % + 24px) уже не влезали в строку — третий переносился вниз.
 * Теперь 33 % — это 4 колонки из 12, а gap считает сама сетка.
 *
 * Ряд, заполненный не полностью, растягивается, как раньше flex-grow:
 * один блок 33 % занимает весь ряд, два по 33 % — по половине.
 * Видео своей ширины не меняет (бывший flex-grow: 0): автор задал ему колонку.
 */
export function contentRowSpans(items = []) {
  const spans = items.map((item) => contentSpan(item?.width));
  const used = spans.reduce((sum, span) => sum + span, 0);
  if (used === 0 || used >= CONTENT_ROW_COLUMNS) return spans;

  const weights = spans.map((span, index) => (items[index]?.type === 'video' ? 0 : span));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const fixed = spans.reduce((sum, span, index) => sum + (weights[index] ? 0 : span), 0);
  const free = CONTENT_ROW_COLUMNS - fixed;
  if (total === 0 || free <= 0) return spans;

  const exact = weights.map((weight) => (free * weight) / total);
  const result = spans.map((span, index) => (weights[index] ? Math.floor(exact[index]) : span));
  let rest = free - result.reduce((sum, span, index) => sum + (weights[index] ? span : 0), 0);

  // Остаток деления — блокам с самой большой дробной частью
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .filter((item) => weights[item.index] > 0)
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; index < order.length && rest > 0; index += 1) {
    result[order[index].index] += 1;
    rest -= 1;
  }

  return result;
}


// ------------------------------------------------------------------ Шаг 10

/** Ограничения редакторов таблиц и чек-листов (совпадает с сервером). */
export const CONTENT_LIMITS = { tableColumns: 6, tableRows: 30, checklistItems: 100 };

/** Языки фрагмента «Код» (совпадает с CODE_LANGUAGES на сервере). */
export const CODE_LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'plaintext', label: 'Без подсветки' },
];

/** Подпись языка по значению. */
export function getCodeLanguageLabel(language) {
  return CODE_LANGUAGES.find((item) => item.value === language)?.label ?? 'Код';
}

/** Варианты выравнивания картинки. */
export const IMAGE_ALIGNS = [
  { value: 'left', label: 'Слева' },
  { value: 'center', label: 'По центру' },
  { value: 'right', label: 'Справа' },
];

/** Ширина картинки внутри колонки, %. */
export const IMAGE_WIDTHS = [25, 50, 75, 100];

/** Выравнивание содержимого видео внутри его колонки (ширина колонки — в шапке карточки). */
export const VIDEO_ALIGNS = [
  { value: 'left', label: 'Слева' },
  { value: 'center', label: 'По центру' },
  { value: 'right', label: 'Справа' },
];

/** Столбцы чек-листа. */
export const CHECKLIST_COLUMNS = [1, 2];

/** Структура data по умолчанию (совпадает с server/src/utils/content.js). */
const CONTENT_DEFAULTS = {
  // lockAspect — «Сохранять пропорции» в редакторе, crop — область обрезки (доли 0–1),
  // aspect — свободные пропорции (высота / ширина), null — натуральные,
  // shapes — рамки выделения (проценты от видимой области картинки)
  image: {
    fileId: null,
    url: '',
    alt: '',
    caption: '',
    width: 100,
    align: 'center',
    aspect: null,
    crop: null,
    lockAspect: true,
    shapes: [],
    notes: [],
  },
  video: { url: '', caption: '', align: 'center', notes: [] },
  checklist: { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: '', checked: false }], notes: [] },
  code: { language: 'javascript', filename: '', code: '', notes: [] },
};

/**
 * data фрагмента с заполненными полями по умолчанию.
 * Текст — Tiptap-документ, его не трогаем; у «важного» рядом с документом
 * нормализуется оформление блока (data.important, см. utils/important.js).
 * Таблица нормализуется отдельно (utils/table.js): ячейки — документы,
 * старые строки с примечаниями переносятся в метки документа.
 */
export function normalizeContentData(type, data) {
  if (type === 'text' || type === 'important') {
    const doc = data && data.type === 'doc' ? data : { type: 'doc', content: [{ type: 'paragraph' }] };
    // Оформление блока «Важное» живёт рядом с документом: data.important
    return type === 'important' ? { ...doc, important: normalizeImportantStyle(doc.important) } : doc;
  }

  if (type === 'table') return normalizeTableData(data, TABLE_LIMITS);

  // Диалог (бывшая «Реплика»): несколько реплик и настройки сцены
  if (type === 'replica') return normalizeDialogData(data);

  const defaults = CONTENT_DEFAULTS[type] ?? {};
  const source = data && typeof data === 'object' ? data : {};
  return { ...defaults, ...source };
}

/** Встраиваемый адрес видео: YouTube, Vimeo или прямой файл (mp4/webm/ogg). */
export function getVideoEmbed(value) {
  const url = String(value ?? '').trim();
  if (!url) return null;

  // Загруженный на сервер файл: относительный путь /uploads/video.mp4
  if (url.startsWith('/uploads/')) {
    return /\.(mp4|webm|ogg)$/i.test(url) ? { provider: 'file', embedUrl: url } : null;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` } : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` } : null;
    }

    const [section, id] = parsed.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(section) && id) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` };
    }

    return null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parsed.pathname.split('/').filter((part) => /^\d+$/.test(part))[0];
    return id ? { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` } : null;
  }

  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) {
    return { provider: 'file', embedUrl: url };
  }

  return null;
}

/* ------------------------------------------------ Шаг 11: тест, памятка, глоссарий */

/** Типы вопросов теста (совпадает с server/src/utils/questions.js). */
export const QUESTION_TYPES = [
  { type: 'single', label: 'Один ответ', icon: 'check', hint: 'Ровно один верный вариант' },
  { type: 'multiple', label: 'Несколько ответов', icon: 'checklist', hint: 'Отметьте все верные варианты' },
  { type: 'match', label: 'Сопоставление', icon: 'link', hint: 'Пары «слева — справа»' },
  { type: 'card', label: 'Карточка', icon: 'layers', hint: 'Вопрос и ответ для заучивания' },
];

const QUESTION_TYPE_BY_NAME = new Map(QUESTION_TYPES.map((item) => [item.type, item]));

/** Метаданные типа вопроса: { type, label, icon, hint }. */
export function getQuestionType(type) {
  return QUESTION_TYPE_BY_NAME.get(type) ?? { type, label: 'Вопрос', icon: 'clipboard', hint: '' };
}

/** Подпись типа вопроса. */
export function getQuestionTypeLabel(type) {
  return getQuestionType(type).label;
}

/** Ограничения размеров вопроса (совпадает с сервером). */
export const QUESTION_LIMITS = { options: 12, pairs: 12, text: 2000 };

/** Пустой Tiptap-документ (без импорта тяжёлого редактора). */
export const createEmptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Tiptap-документ из простого текста: каждая строка — абзац. */
export function textToDoc(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return createEmptyDoc();

  return {
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

/**
 * Простой текст из Tiptap-документа (для поиска и превью).
 * Внутри абзаца inline-узлы (например, части текста с разными метками)
 * склеиваются без пробела, а блоки разделяются separator.
 */
export function docToText(doc, separator = ' ') {
  const gap = String(separator ?? ' ');
  const inlineContent = new Set(['paragraph', 'heading', 'codeBlock']);

  const collect = (node) => {
    if (!node) return '';
    if (typeof node.text === 'string') return node.text;
    if (node.type === 'hardBreak') return gap;

    const children = Array.isArray(node.content) ? node.content : [];
    const glue = inlineContent.has(node.type) ? '' : gap;
    return children.map(collect).filter(Boolean).join(glue);
  };

  return collect(doc).replace(/\s+/g, ' ').trim();
}

/** Сортировка терминов глоссария по алфавиту (русский язык). */
const TERM_COLLATOR = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function sortTerms(terms) {
  return [...terms].sort((a, b) => TERM_COLLATOR.compare(a.term ?? '', b.term ?? ''));
}

/** Первая буква термина для заголовков-разделителей. */
export function getTermLetter(term) {
  const letter = String(term ?? '').trim().charAt(0).toUpperCase();
  return /[A-ZА-ЯЁ]/.test(letter) ? letter : '#';
}

/** Новый порядок id после сдвига одного элемента; null — сдвиг невозможен. */
export function movedIds(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;

  if (from < 0 || to < 0 || to >= ids.length) return null;

  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

