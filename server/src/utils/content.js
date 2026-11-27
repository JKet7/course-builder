/**
 * Общие правила для контента слайдов теории (Шаг 9).
 *
 * `dataVersion` — константа сервера: клиент её не присылает и не может изменить,
 * но получает в каждом ответе с TheoryContent (см. «Архитектура» п. 2.2).
 */

import { docFromText, emptyDoc, isTiptapDoc } from './tiptap.js';

/** Текущая версия формата TheoryContent.data. */
export const CURRENT_DATA_VERSION = 1;

/** Типы фрагментов контента слайда. */
export const CONTENT_TYPES = ['text', 'table', 'image', 'video', 'important', 'checklist', 'code', 'replica'];

/** Допустимые ширины колонки в ряду (максимум 3 колонки). */
export const CONTENT_WIDTHS = [33, 50, 66, 100];

/** Языки для фрагмента «Код» (совпадает с client/src/utils/helpers.js). */
export const CODE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'csharp',
  'sql',
  'html',
  'css',
  'bash',
  'json',
  'plaintext',
];

/** Ограничения размеров для таблиц и чек-листов. */
export const CONTENT_LIMITS = { tableColumns: 6, tableRows: 30, checklistItems: 100 };

/** Поля TheoryContent, которые отдаём клиенту (dataVersion обязателен). */
export const CONTENT_SELECT = {
  id: true,
  slideId: true,
  type: true,
  data: true,
  dataVersion: true,
  width: true,
  order: true,
  createdAt: true,
  updatedAt: true,
};

/** Пустой Tiptap-документ: один пустой абзац (общий хелпер Шага 11). */
export { emptyDoc };

/** Данные по умолчанию для нового фрагмента контента. */
export function defaultContentData(type) {
  switch (type) {
    case 'text':
    case 'important':
      return emptyDoc();
    case 'table':
      // Ячейки — Tiptap-документы (см. normalizeTable ниже)
      return {
        columns: 2,
        rows: 2,
        cells: [
          [emptyDoc(), emptyDoc()],
          [emptyDoc(), emptyDoc()],
        ],
        merges: [],
        headerRow: true,
      };
    case 'image':
      return {
        fileId: null,
        url: '',
        alt: '',
        caption: '',
        width: 100,
        align: 'center',
        // aspect — свободные пропорции (высота / ширина), crop — область обрезки (доли 0–1)
        aspect: null,
        crop: null,
        lockAspect: true,
        // shapes — рамки выделения (проценты от видимой области картинки)
        shapes: [],
        notes: [],
        links: [],
      };
    case 'video':
      return { url: '', caption: '', align: 'center', notes: [], links: [] };
    case 'checklist':
      return { title: 'Чек-лист', columns: 1, items: [{ id: '1', text: '', checked: false }], notes: [], links: [] };
    case 'code':
      return { language: 'javascript', filename: '', code: '', notes: [], links: [] };
    case 'replica':
      // Диалог (бывшая «Реплика»): одна пустая реплика и оформление сцены
      return {
        lines: [
          {
            id: 'line-1',
            character: '',
            side: 'left',
            position: 'auto',
            avatar: '',
            avatarFocus: { x: 50, y: 50 },
            avatarZoom: 1,
            text: '',
          },
        ],
        avatarSize: 72,
        bubbleColor: '',
        borderColor: '',
        borderWidth: 2,
        radius: 16,
        showTail: true,
        tail: 'auto',
        textAlign: 'left',
        notes: [],
        links: [],
      };
    default:
      return {};
  }
}

/**
 * Примечания обычного текста (Правка 5): { id, text, field, ref, from, to, word }.
 * Хранятся в data.notes у таблицы, чек-листа, картинки, видео, кода и реплики.
 * У маркера картинки (field = 'marker') вместо диапазона слова — точка x/y в процентах.
 */
export const IMAGE_MARKER_FIELD = 'marker';
export const NOTE_FIELDS = ['title', 'caption', 'code', 'text', 'cell', 'item', IMAGE_MARKER_FIELD];
export const NOTES_LIMIT = 200;
const NOTE_TEXT_LIMIT = 300;
const NOTE_WORD_LIMIT = 300;

/** Координата маркера в процентах от картинки: 0–100, один знак после запятой. */
function normalizeMarkerPoint(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
}

function normalizeNotes(value) {
  if (!Array.isArray(value)) return [];

  const notes = [];
  for (const item of value.slice(0, NOTES_LIMIT)) {
    if (!isPlainObject(item)) continue;

    const id = asText(item.id, '').slice(0, 60);
    const text = asText(item.text, '').replace(/\s+/g, ' ').trim().slice(0, NOTE_TEXT_LIMIT);
    const field = asText(item.field, '');
    if (!id || !text || !NOTE_FIELDS.includes(field)) continue;

    notes.push({
      id,
      text,
      field,
      ref: asText(item.ref, '').slice(0, 60),
      from: asInt(item.from, 0, 100000, 0),
      to: asInt(item.to, 0, 100000, 0),
      word: asText(item.word, '').replace(/\s+/g, ' ').trim().slice(0, NOTE_WORD_LIMIT),
      ...(field === IMAGE_MARKER_FIELD
        ? { x: normalizeMarkerPoint(item.x), y: normalizeMarkerPoint(item.y) }
        : {}),
    });
  }

  return notes;
}

/**
 * Ссылки обычного текста (Правка 6): { id, field, ref, from, to, word, kind,
 * href, targetType, targetId, targetBlockId, targetLabel, targetBadge,
 * newTab }. Внутренняя ссылка хранит готовый путь /block/… — так просмотр
 * и печать не зависят от карты курса.
 */
export const LINK_FIELDS = ['title', 'caption', 'code', 'text', 'cell', 'item'];
export const LINKS_LIMIT = 200;
const LINK_HREF_LIMIT = 1000;
const LINK_WORD_LIMIT = 300;
const LINK_LABEL_LIMIT = 300;
const TARGET_TYPES = ['block', 'slide', 'question', 'memo', 'term'];

function normalizeLinks(value) {
  if (!Array.isArray(value)) return [];

  const links = [];
  for (const item of value.slice(0, LINKS_LIMIT)) {
    if (!isPlainObject(item)) continue;

    const id = asText(item.id, '').slice(0, 60);
    const field = asText(item.field, '');
    const kind = item.kind === 'internal' ? 'internal' : 'external';
    const href = asText(item.href, '').slice(0, LINK_HREF_LIMIT).trim();
    if (!id || !href || !LINK_FIELDS.includes(field)) continue;

    const internal = kind === 'internal';

    links.push({
      id,
      field,
      ref: asText(item.ref, '').slice(0, 60),
      from: asInt(item.from, 0, 100000, 0),
      to: asInt(item.to, 0, 100000, 0),
      word: asText(item.word, '').replace(/\s+/g, ' ').trim().slice(0, LINK_WORD_LIMIT),
      kind,
      href,
      targetType: internal ? oneOf(asText(item.targetType, ''), TARGET_TYPES, 'block') : '',
      targetId: internal ? asText(item.targetId, '').slice(0, 60) : '',
      targetBlockId: internal ? asText(item.targetBlockId, '').slice(0, 60) : '',
      targetLabel: internal ? asText(item.targetLabel, '').slice(0, LINK_LABEL_LIMIT) : '',
      targetBadge: internal ? asText(item.targetBadge, '').slice(0, 40) : '',
      newTab: internal ? false : Boolean(item.newTab),
    });
  }

  return links;
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asText = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
};

const asInt = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/* --------------------------------------------------------- таблица (Шаг 10) */

/**
 * Ячейка таблицы — Tiptap-документ: внутри работают форматирование, списки,
 * ссылки и примечания. Старый формат (строка + data.notes/links с диапазонами
 * from/to) переносится в документ при сохранении: текст разбивается по границам
 * аннотаций, примечание становится меткой inlineNote, ссылка — меткой link.
 *
 * Объединённые ячейки — список { row, col, rowSpan, colSpan } у верхней левой
 * ячейки; текст закрытых ячеек очищается (как в Google Таблицах).
 * Те же правила — в client/src/utils/table.js.
 */

/** Тип метки примечания (совпадает с client/src/utils/notes.js). */
const NOTE_MARK_TYPE = 'inlineNote';

/** Диапазоны аннотаций: при расхождении слово ищется заново, как в plainText.js. */
function placeRanges(text, items) {
  const placed = [];

  for (const item of items) {
    let from = Number(item.from);
    let to = Number(item.to);
    const word = String(item.word ?? '');
    const exact =
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      from >= 0 &&
      to > from &&
      to <= text.length &&
      (!word || text.slice(from, to) === word);

    if (!exact) {
      if (word) {
        const index = text.indexOf(word);
        if (index >= 0) {
          from = index;
          to = index + word.length;
        } else {
          from = text.length;
          to = text.length;
        }
      } else {
        from = 0;
        to = text.length;
      }
    }

    placed.push({ item, from, to });
  }

  return placed.sort((a, b) => a.from - b.from);
}

/** Атрибуты метки link (совпадает с client/src/utils/links.js linkToMarkAttrs). */
function linkMarkAttrs(link) {
  return {
    href: link.href ?? '',
    linkKind: link.kind === 'internal' ? 'internal' : 'external',
    targetType: link.targetType ?? '',
    targetId: link.targetId ?? '',
    targetBlockId: link.targetBlockId ?? '',
    targetLabel: link.targetLabel ?? '',
    targetBadge: link.targetBadge ?? '',
    newTab: Boolean(link.newTab),
  };
}

/** Документ ячейки из строки и аннотаций старого формата. */
function legacyCellDoc(text, notes = [], links = []) {
  if (!text) return emptyDoc();
  if (notes.length === 0 && links.length === 0) return docFromText(text);

  const noteRanges = placeRanges(text, notes);
  const linkRanges = placeRanges(text, links);
  const points = new Set([0, text.length]);

  for (const range of [...noteRanges, ...linkRanges]) {
    points.add(range.from);
    points.add(range.to);
  }

  const sorted = [...points].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);
  const nodes = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (to <= from) continue;

    const note = noteRanges.find((range) => range.from <= from && range.to >= to);
    const link = linkRanges.find((range) => range.from <= from && range.to >= to);
    const marks = [];

    if (note) marks.push({ type: NOTE_MARK_TYPE, attrs: { noteId: note.item.id, text: note.item.text } });
    if (link) marks.push({ type: 'link', attrs: linkMarkAttrs(link.item) });

    nodes.push({ type: 'text', text: text.slice(from, to), ...(marks.length > 0 ? { marks } : {}) });
  }

  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
}

/** Ячейка из запроса: документ или строка старого формата. */
function normalizeCell(value, notes, links) {
  if (isTiptapDoc(value)) return value;
  return legacyCellDoc(asText(value), notes, links);
}

/** Объединения после изменения размеров: без пересечений и выходов за границы. */
function normalizeMerges(merges, rows, columns) {
  const list = Array.isArray(merges) ? merges : [];
  const result = [];

  for (const item of list) {
    if (!isPlainObject(item)) continue;

    const row = asInt(item.row, 0, rows - 1, 0);
    const col = asInt(item.col, 0, columns - 1, 0);
    const rowSpan = asInt(item.rowSpan, 1, rows - row, 1);
    const colSpan = asInt(item.colSpan, 1, columns - col, 1);
    if (rowSpan === 1 && colSpan === 1) continue;

    const candidate = { row, col, rowSpan, colSpan };
    const clash = result.some(
      (merge) =>
        merge.row <= candidate.row + candidate.rowSpan - 1 &&
        candidate.row <= merge.row + merge.rowSpan - 1 &&
        merge.col <= candidate.col + candidate.colSpan - 1 &&
        candidate.col <= merge.col + merge.colSpan - 1,
    );
    if (clash) continue;

    result.push(candidate);
  }

  return result;
}

/** Закрытые ячейки объединений не хранят текст: его рисует верхняя левая. */
function clearCoveredCells(cells, merges) {
  for (const merge of merges) {
    for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
      for (let column = merge.col; column < merge.col + merge.colSpan; column += 1) {
        if (row === merge.row && column === merge.col) continue;
        if (cells[row]?.[column] !== undefined) cells[row][column] = emptyDoc();
      }
    }
  }
}

function normalizeTable(data) {
  const columns = asInt(data.columns, 1, CONTENT_LIMITS.tableColumns, 2);
  const rows = asInt(data.rows, 1, CONTENT_LIMITS.tableRows, 2);
  const source = Array.isArray(data.cells) ? data.cells : [];
  // Старый формат: примечания и ссылки лежали рядом с ячейками (data.notes/links)
  const notes = normalizeNotes(data.notes).filter((note) => note.field === 'cell');
  const links = normalizeLinks(data.links).filter((link) => link.field === 'cell');

  const cells = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) => {
      const ref = `${rowIndex}-${columnIndex}`;
      return normalizeCell(
        source[rowIndex]?.[columnIndex],
        notes.filter((note) => String(note.ref ?? '') === ref),
        links.filter((link) => String(link.ref ?? '') === ref),
      );
    }),
  );

  const merges = normalizeMerges(data.merges, rows, columns);
  clearCoveredCells(cells, merges);

  return { columns, rows, cells, merges, headerRow: Boolean(data.headerRow) };
}

function normalizeChecklist(data) {
  const items = Array.isArray(data.items) ? data.items.slice(0, CONTENT_LIMITS.checklistItems) : [];

  return {
    title: asText(data.title, 'Чек-лист'),
    columns: oneOf(Number(data.columns), [1, 2], 1),
    items: items.map((item, index) => {
      const id = asText(item?.id, '') || String(index + 1);
      return { id, text: asText(item?.text), checked: Boolean(item?.checked) };
    }),
    notes: normalizeNotes(data.notes),
    links: normalizeLinks(data.links),
  };
}

/** Число из data с ограничением диапазона (для обрезки и пропорций картинки). */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Обрезка картинки: { x, y, w, h } в долях исходника (0–1).
 * null — обрезки нет или она закрывает картинку целиком.
 */
function normalizeImageCrop(value) {
  if (!isPlainObject(value)) return null;

  const x = clampNumber(value.x, 0, 0.95, 0);
  const y = clampNumber(value.y, 0, 0.95, 0);
  const w = clampNumber(value.w, 0.05, 1 - x, 1);
  const h = clampNumber(value.h, 0.05, 1 - y, 1);
  const round = (number) => Math.round(number * 10000) / 10000;

  if (x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999) return null;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Свободные пропорции картинки (высота / ширина); null — натуральные пропорции. */
function normalizeImageAspect(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0.05 || number >= 20) return null;
  return Math.round(number * 1000) / 1000;
}

/* ------------------------------------------ рамки выделения (правка 2.5) */

/** Предел числа рамок у одной картинки (совпадает с client/src/utils/image.js). */
export const IMAGE_SHAPES_LIMIT = 20;

/** Фигуры рамок выделения. */
export const IMAGE_SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'arrow'];

/** Минимальная сторона рамки — 3 % видимой области картинки. */
export const IMAGE_SHAPE_MIN_SIZE = 3;

/** Цвет рамки по умолчанию — «красный» из набора «Цвета системы». */
export const IMAGE_SHAPE_DEFAULT_COLOR = '#E03131';

/** Цвет рамки: HEX в формате #RRGGBB, иначе — красный по умолчанию. */
function normalizeShapeColor(value) {
  const text = asText(value, '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return IMAGE_SHAPE_DEFAULT_COLOR;

  const hex = text.slice(1);
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  return `#${full.toUpperCase()}`;
}

/** Координата или размер рамки в процентах: 0–100, один знак после запятой. */
function normalizeShapeNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(Math.max(number, min), max) * 10) / 10;
}

/**
 * Рамки выделения картинки: { id, type, x, y, w, h, rotation, color, fill, stroke }.
 * Геометрия — проценты от видимой области (после обрезки), поворот — градусы
 * (−180…180), fill — прозрачность заливки 0–100 %, stroke — контур 0–4 px.
 */
function normalizeImageShapes(value) {
  if (!Array.isArray(value)) return [];

  const shapes = [];
  for (const [index, item] of value.slice(0, IMAGE_SHAPES_LIMIT).entries()) {
    if (!isPlainObject(item)) continue;

    const w = normalizeShapeNumber(item.w, IMAGE_SHAPE_MIN_SIZE, 100, 20);
    const h = normalizeShapeNumber(item.h, IMAGE_SHAPE_MIN_SIZE, 100, 20);

    shapes.push({
      id: asText(item.id, '').slice(0, 60) || `shape-${index + 1}`,
      type: IMAGE_SHAPE_TYPES.includes(item.type) ? item.type : 'rect',
      x: normalizeShapeNumber(item.x, 0, 100 - w, 0),
      y: normalizeShapeNumber(item.y, 0, 100 - h, 0),
      w,
      h,
      rotation: asInt(item.rotation, -180, 180, 0),
      color: normalizeShapeColor(item.color),
      fill: asInt(item.fill, 0, 100, 0),
      stroke: asInt(item.stroke, 0, 4, 2),
    });
  }

  return shapes;
}

function normalizeImage(data) {
  return {
    fileId: typeof data.fileId === 'string' && data.fileId ? data.fileId : null,
    url: asText(data.url),
    alt: asText(data.alt),
    caption: asText(data.caption),
    width: asInt(data.width, 10, 100, 100),
    align: oneOf(data.align, ['left', 'center', 'right'], 'center'),
    aspect: normalizeImageAspect(data.aspect),
    crop: normalizeImageCrop(data.crop),
    lockAspect: data.lockAspect !== false,
    shapes: normalizeImageShapes(data.shapes),
    notes: normalizeNotes(data.notes),
    links: normalizeLinks(data.links),
  };
}

/* ------------------------------------------------------------ диалог (Правка 11) */

/**
 * Диалог: несколько реплик персонажей в одном фрагменте.
 * Совпадает с client/src/utils/dialog.js — пределы и наборы значений те же.
 * Старый формат «Реплики» ({ character, side, text }) становится одной репликой.
 */
export const DIALOG_LIMITS = {
  lines: 20,
  text: 4000,
  character: 120,
  avatar: 1000,
  avatarSize: [40, 240],
  avatarZoom: [1, 3],
  borderWidth: [0, 8],
  radius: [0, 32],
};

export const DIALOG_SIDES = ['left', 'center', 'right'];
export const DIALOG_POSITIONS = ['auto', 'left', 'right', 'top', 'bottom'];
export const DIALOG_TAILS = ['auto', 'left', 'right', 'top', 'bottom'];
export const DIALOG_TEXT_ALIGNS = ['left', 'center'];

/**
 * Куда смотрит кружок аватара: точка картинки в процентах (0–100).
 * По умолчанию — центр, как обрезалась картинка до появления выбора области.
 */
function normalizeDialogFocus(value) {
  const source = isPlainObject(value) ? value : {};

  return {
    x: asInt(source.x, 0, 100, 50),
    y: asInt(source.y, 0, 100, 50),
  };
}

/** Масштаб аватара в кружке: 1–3 с шагом 0.1. */
function normalizeDialogZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;

  const clamped = Math.min(DIALOG_LIMITS.avatarZoom[1], Math.max(DIALOG_LIMITS.avatarZoom[0], number));
  return Math.round(clamped * 10) / 10;
}

/** Цвет облака или рамки: пустая строка — «как в теме», иначе #RRGGBB. */
function normalizeDialogColor(value) {
  const text = asText(value, '').trim();
  if (!text) return '';
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return '';
  return normalizeShapeColor(text);
}

/** Реплика диалога: кто говорит, где стоит и что говорит. */
function normalizeDialogLine(item, index) {
  const source = isPlainObject(item) ? item : {};

  return {
    id: asText(source.id, '').slice(0, 60) || `line-${index + 1}`,
    character: asText(source.character, '')
      .replace(/\s+/g, ' ')
      .trimStart()
      .slice(0, DIALOG_LIMITS.character),
    side: oneOf(source.side, DIALOG_SIDES, 'left'),
    position: oneOf(source.position, DIALOG_POSITIONS, 'auto'),
    avatar: asText(source.avatar, '').trim().slice(0, DIALOG_LIMITS.avatar),
    // Кружок аватара: какая часть картинки видна и насколько крупно
    avatarFocus: normalizeDialogFocus(source.avatarFocus),
    avatarZoom: normalizeDialogZoom(source.avatarZoom),
    // NUL недопустим в DOM, но позиции примечаний должны остаться на месте
    text: asText(source.text, '').replace(/\u0000/g, ' ').slice(0, DIALOG_LIMITS.text),
  };
}

function normalizeDialog(data) {
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  let lines = rawLines
    .slice(0, DIALOG_LIMITS.lines)
    .map((line, index) => (isPlainObject(line) ? normalizeDialogLine(line, index) : null))
    .filter(Boolean);

  if (lines.length === 0) {
    // Совместимость: «Реплика» старого формата — одна реплика
    lines = [normalizeDialogLine({ character: data.character, side: data.side, text: data.text }, 0)];
  }

  return {
    lines,
    avatarSize: asInt(data.avatarSize, ...DIALOG_LIMITS.avatarSize, 72),
    bubbleColor: normalizeDialogColor(data.bubbleColor),
    borderColor: normalizeDialogColor(data.borderColor),
    borderWidth: asInt(data.borderWidth, ...DIALOG_LIMITS.borderWidth, 2),
    radius: asInt(data.radius, ...DIALOG_LIMITS.radius, 16),
    showTail: data.showTail !== false,
    tail: oneOf(data.tail, DIALOG_TAILS, 'auto'),
    textAlign: oneOf(data.textAlign, DIALOG_TEXT_ALIGNS, 'left'),
    notes: normalizeNotes(data.notes),
    links: normalizeLinks(data.links),
  };
}

const CONTENT_NORMALIZERS = {
  table: normalizeTable,
  checklist: normalizeChecklist,
  image: normalizeImage,
  video: (data) => ({
    url: asText(data.url).trim(),
    caption: asText(data.caption),
    // Положение блока на слайде; ширина колонки — TheoryContent.width
    align: oneOf(data.align, ['left', 'center', 'right'], 'center'),
    notes: normalizeNotes(data.notes),
    links: normalizeLinks(data.links),
  }),
  code: (data) => ({
    language: oneOf(asText(data.language, 'javascript'), CODE_LANGUAGES, 'javascript'),
    filename: asText(data.filename),
    // NUL недопустим в DOM и буфере обмена; меняем на пробел той же длины,
    // чтобы позиции примечаний и ссылок остались на месте.
    code: asText(data.code).replace(/\u0000/g, ' '),
    notes: normalizeNotes(data.notes),
    links: normalizeLinks(data.links),
  }),
  replica: normalizeDialog,
};

/* --------------------------------------------------------- «Важное» (оформление) */

/** Пределы оформления блока «Важное» (совпадает с client/src/utils/important.js). */
const IMPORTANT_LIMITS = { borderWidth: [1, 2], radius: [8, 12] };

/**
 * Оформление блока «Важное».
 *
 * Текст «Важного» — Tiptap-документ, а цвета и рамка лежат рядом с ним в
 * data.important: так документ остаётся валидным (data.type === 'doc'), а
 * старые записи без оформления получают значения по умолчанию. Пустой цвет —
 * «как в теме», пустой borderColor — рамка на 18 % темнее фона (клиент).
 */
export function normalizeImportantStyle(value) {
  const source = isPlainObject(value) ? value : {};

  return {
    background: normalizeDialogColor(source.background),
    borderColor: normalizeDialogColor(source.borderColor),
    borderWidth: asInt(source.borderWidth, ...IMPORTANT_LIMITS.borderWidth, 1),
    radius: asInt(source.radius, ...IMPORTANT_LIMITS.radius, 10),
  };
}

/**
 * Проверка и нормализация data для указанного типа.
 * Возвращает { ok: true, data } либо { ok: false, message }.
 */
export function normalizeContentData(type, data) {
  if (data === undefined || data === null) {
    return { ok: true, data: defaultContentData(type) };
  }

  if (!isPlainObject(data)) {
    return { ok: false, message: 'Поле data должно быть объектом' };
  }

  if (type === 'text' || type === 'important') {
    if (data.type !== 'doc') {
      return { ok: false, message: 'Для текста ожидается Tiptap-документ (data.type = "doc")' };
    }

    if (type === 'important') {
      return { ok: true, data: { ...data, important: normalizeImportantStyle(data.important) } };
    }

    return { ok: true, data };
  }

  const merged = { ...defaultContentData(type), ...data };
  const normalize = CONTENT_NORMALIZERS[type];

  return { ok: true, data: normalize ? normalize(merged) : merged };
}
