/**
 * Таблица слайда (правка «Работа с таблицей»).
 *
 * Ячейка — не строка, а Tiptap-документ: внутри работают те же возможности,
 * что и у фрагмента «Текст», — жирный, курсив, цвет, размер шрифта, списки,
 * ссылки и примечания. Примечания и ссылки ячейки живут метками внутри
 * документа, поэтому отдельные массивы data.notes / data.links таблице больше
 * не нужны: старые таблицы переносятся в документы при чтении и сохранении
 * (legacyCellDoc, normalizeTableData, normalizeTable на сервере).
 *
 * Объединённые ячейки хранятся списком { row, col, rowSpan, colSpan } у верхней
 * левой ячейки диапазона; текст остальных ячеек диапазона очищается — как в
 * Google Таблицах. Все операции с выделением, объединением и буфером обмена —
 * чистые функции, их проверяют scripts/editor-check.mjs и scripts/render-check.mjs.
 */

import { placeTextRanges } from './plainText.js';

/** Пределы таблицы по умолчанию (совпадает с CONTENT_LIMITS в helpers.js). */
export const TABLE_LIMITS = { columns: 6, rows: 30 };

/** Тип метки примечания (см. utils/notes.js — модуль не импортируем, чтобы не было цикла). */
const NOTE_MARK_TYPE = 'inlineNote';

/** Пустой Tiptap-документ ячейки: один пустой абзац. */
export const emptyCellDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Похоже ли значение на Tiptap-документ. */
export function isCellDoc(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.type === 'doc';
}

/** Целое число в диапазоне [min, max]; иначе — значение по умолчанию. */
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

/** Документ из простого текста: каждая строка — абзац. */
export function docFromText(text) {
  const lines = String(text ?? '').split(/\r?\n/);

  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

/** Простой текст документа (для буфера обмена, поиска и подсказок). */
export function docToPlainText(doc, separator = ' ') {
  const collect = (node) => {
    if (!node) return '';
    if (typeof node.text === 'string') return node.text;
    return (node.content ?? []).map(collect).join(separator);
  };

  return collect(doc).replace(/\s+/g, ' ').trim();
}

/** Ячейка из сохранённого значения: документ, строка (старый формат) или пусто. */
export function normalizeCell(value) {
  if (isCellDoc(value)) return value;
  if (typeof value === 'string') return docFromText(value);
  return emptyCellDoc();
}

/** Атрибуты метки link из обычной ссылки — копия utils/links.js linkToMarkAttrs. */
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

/**
 * Документ ячейки старого формата: строка + примечания и ссылки с
 * диапазонами from/to. Текст разбивается по границам аннотаций, поэтому
 * метки ставятся на те же слова, что были подчёркнуты в просмотре.
 * Текст не обрезается: диапазоны остаются смещениями в исходной строке.
 */
export function legacyCellDoc(value, notes = [], links = []) {
  const text = String(value ?? '');
  if (!text) return emptyCellDoc();
  if (notes.length === 0 && links.length === 0) return docFromText(text);

  const noteRanges = placeTextRanges(text, notes);
  const linkRanges = placeTextRanges(text, links);
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

/* ------------------------------------------------------- объединённые ячейки */

/** Прямоугольник объединения в координатах сетки. */
export function mergeRect(merge) {
  return {
    top: merge.row,
    left: merge.col,
    bottom: merge.row + merge.rowSpan - 1,
    right: merge.col + merge.colSpan - 1,
  };
}

/** Пересекаются ли два прямоугольника. */
function rectsIntersect(a, b) {
  return a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
}

/** Ячейка входит в прямоугольник. */
export function isInRect(rect, row, column) {
  return row >= rect.top && row <= rect.bottom && column >= rect.left && column <= rect.right;
}

/** Объединение покрывает ячейку. */
function insideMerge(merge, row, column) {
  return (
    row >= merge.row && row < merge.row + merge.rowSpan && column >= merge.col && column < merge.col + merge.colSpan
  );
}

/** Объединение, накрывающее ячейку, или null. */
export function mergeAt(merges, row, column) {
  return (merges ?? []).find((merge) => insideMerge(merge, row, column)) ?? null;
}

/** Ячейка скрыта объединением (её рисует верхняя левая). */
export function isCovered(merges, row, column) {
  const merge = mergeAt(merges, row, column);
  return Boolean(merge) && (merge.row !== row || merge.col !== column);
}

/** Верхняя левая ячейка, которая рисует данную: { row, col }. */
export function anchorOf(merges, row, column) {
  const merge = mergeAt(merges, row, column);
  return merge ? { row: merge.row, col: merge.col } : { row, col: column };
}

/**
 * Объединения после изменения размера таблицы: обрезаются по границам,
 * пересечения отбрасываются, одиночные ячейки в список не попадают.
 */
export function normalizeMerges(merges, rows, columns) {
  const list = Array.isArray(merges) ? merges : [];
  const result = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const row = clampInt(item.row, 0, rows - 1, 0);
    const col = clampInt(item.col, 0, columns - 1, 0);
    const rowSpan = clampInt(item.rowSpan, 1, rows - row, 1);
    const colSpan = clampInt(item.colSpan, 1, columns - col, 1);
    if (rowSpan === 1 && colSpan === 1) continue;

    const candidate = { row, col, rowSpan, colSpan };
    if (result.some((merge) => rectsIntersect(mergeRect(merge), mergeRect(candidate)))) continue;

    result.push(candidate);
  }

  return result;
}

/** Текст закрытых ячеек объединений не нужен: его рисует верхняя левая. */
function clearCovered(cells, merges) {
  if (merges.length === 0) return cells;

  return cells.map((row, rowIndex) =>
    row.map((doc, columnIndex) => (isCovered(merges, rowIndex, columnIndex) ? emptyCellDoc() : doc)),
  );
}

/**
 * Полная нормализация data таблицы: размеры, ячейки-документы, объединения.
 * Старый формат (строки + data.notes / data.links) переносится в документы.
 */
export function normalizeTableData(data, limits = TABLE_LIMITS) {
  const source = data && typeof data === 'object' ? data : {};
  const columns = clampInt(source.columns, 1, limits.columns, 2);
  const rows = clampInt(source.rows, 1, limits.rows, 2);

  const legacyNotes = (Array.isArray(source.notes) ? source.notes : []).filter((note) => note?.field === 'cell');
  const legacyLinks = (Array.isArray(source.links) ? source.links : []).filter((link) => link?.field === 'cell');
  const rawCells = Array.isArray(source.cells) ? source.cells : [];

  let cells = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) => {
      const value = rawCells[rowIndex]?.[columnIndex];
      if (typeof value === 'string') {
        const ref = `${rowIndex}-${columnIndex}`;
        return legacyCellDoc(
          value,
          legacyNotes.filter((note) => String(note.ref ?? '') === ref),
          legacyLinks.filter((link) => String(link.ref ?? '') === ref),
        );
      }

      return normalizeCell(value);
    }),
  );

  const merges = normalizeMerges(source.merges, rows, columns);
  cells = clearCovered(cells, merges);

  return {
    columns,
    rows,
    cells,
    merges,
    // У новой таблицы первая строка — заголовок (совпадает с data по умолчанию)
    headerRow: source.headerRow === undefined ? true : Boolean(source.headerRow),
    notes: [],
    links: [],
  };
}

/** Таблица с новыми размерами: недостающие ячейки пустые, лишние отбрасываются. */
export function resizeTable(data, rows, columns) {
  const cells = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) =>
      isCellDoc(data.cells?.[rowIndex]?.[columnIndex]) ? data.cells[rowIndex][columnIndex] : emptyCellDoc(),
    ),
  );

  const merges = normalizeMerges(data.merges, rows, columns);
  return { ...data, rows, columns, cells: clearCovered(cells, merges), merges };
}

/** Записать документ в ячейку (объединённая ячейка пишется в верхнюю левую). */
export function setCellDoc(data, row, column, doc) {
  const anchor = anchorOf(data.merges, row, column);
  const cells = data.cells.map((line, rowIndex) =>
    line.map((cell, columnIndex) => (rowIndex === anchor.row && columnIndex === anchor.col ? doc : cell)),
  );

  return { ...data, cells };
}

/* ---------------------------------------------------------- выделение ячеек */

/** Прямоугольник выделения по двум ячейкам (якорь и текущая). */
export function selectionRect(anchor, focus) {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

/** Ячейки прямоугольника: [{ row, col }]. */
export function rectCells(rect) {
  const cells = [];
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let column = rect.left; column <= rect.right; column += 1) cells.push({ row, col: column });
  }
  return cells;
}

/** Сколько ячеек рисует выделение (объединённые считаются один раз). */
export function selectionAnchors(merges, rect) {
  const seen = new Map();

  for (const cell of rectCells(rect)) {
    const anchor = anchorOf(merges, cell.row, cell.col);
    seen.set(`${anchor.row}-${anchor.col}`, anchor);
  }

  return [...seen.values()];
}

/** Можно ли объединить выделение: минимум две ячейки и ни одного «выхода» за границы. */
export function canMerge(data, rect) {
  const merges = data.merges ?? [];
  if (selectionAnchors(merges, rect).length < 2) return false;

  // Объединение, которое не помещается в выделение, разорвалось бы
  return !merges.some((merge) => {
    const area = mergeRect(merge);
    if (!rectsIntersect(area, rect)) return false;
    return area.top < rect.top || area.left < rect.left || area.bottom > rect.bottom || area.right > rect.right;
  });
}

/** Есть ли в выделении объединённая ячейка (кнопка «Разделить»). */
export function canUnmerge(data, rect) {
  return (data.merges ?? []).some((merge) => rectsIntersect(mergeRect(merge), rect));
}

/** Есть ли текст в выделенных ячейках, кроме верхней левой (предупреждение при объединении). */
export function hasTextOutsideAnchor(data, rect) {
  return (data.cells ?? []).some((line, rowIndex) =>
    line.some((doc, columnIndex) => {
      if (!isInRect(rect, rowIndex, columnIndex)) return false;
      if (rowIndex === rect.top && columnIndex === rect.left) return false;
      return docToPlainText(doc) !== '';
    }),
  );
}

/** Объединить выделение: текст остаётся только в верхней левой ячейке. */
export function mergeRectCells(data, rect) {
  const merges = [
    ...(data.merges ?? []).filter((merge) => !rectsIntersect(mergeRect(merge), rect)),
    { row: rect.top, col: rect.left, rowSpan: rect.bottom - rect.top + 1, colSpan: rect.right - rect.left + 1 },
  ];

  const cells = data.cells.map((line, rowIndex) =>
    line.map((doc, columnIndex) => {
      if (!isInRect(rect, rowIndex, columnIndex)) return doc;
      return rowIndex === rect.top && columnIndex === rect.left ? doc : emptyCellDoc();
    }),
  );

  return { ...data, cells, merges: normalizeMerges(merges, data.rows, data.columns) };
}

/** Разделить объединённые ячейки в выделении: текст остаётся в верхней левой. */
export function unmergeRectCells(data, rect) {
  const merges = (data.merges ?? []).filter((merge) => !rectsIntersect(mergeRect(merge), rect));
  return { ...data, merges };
}

/** Очистить текст выделенных ячеек (Delete). */
export function clearRect(data, rect) {
  const cells = data.cells.map((line, rowIndex) =>
    line.map((doc, columnIndex) => {
      if (!isInRect(rect, rowIndex, columnIndex)) return doc;
      if (isCovered(data.merges, rowIndex, columnIndex)) return doc;
      return emptyCellDoc();
    }),
  );

  return { ...data, cells };
}

/* --------------------------------------------------------- буфер обмена (TSV) */

/** Таблица в текст с табуляцией и переводами строк — формат Excel и Google Таблиц. */
export function tableToTsv(data) {
  return (data.cells ?? [])
    .map((line) => line.map((doc) => docToPlainText(doc).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/**
 * Вставить матрицу из буфера обмена начиная с ячейки start.
 * Таблица расширяется до нужного размера, но не больше limits.
 * Возвращает { data, rows, columns }: rows/columns — сколько влезло.
 */
export function pasteMatrix(data, start, matrix, limits = TABLE_LIMITS) {
  const source = Array.isArray(matrix) ? matrix : [];
  if (source.length === 0) return { data, rows: 0, columns: 0 };

  const startRow = Math.max(0, Number(start?.row) || 0);
  const startColumn = Math.max(0, Number(start?.col) || 0);
  const width = Math.max(...source.map((line) => (Array.isArray(line) ? line.length : 0)));
  const rows = Math.min(Math.max(data.rows, startRow + source.length), limits.rows);
  const columns = Math.min(Math.max(data.columns, startColumn + width), limits.columns);
  const resized = resizeTable(data, rows, columns);
  let pastedRows = 0;
  let pastedColumns = 0;

  const cells = resized.cells.map((line, rowIndex) =>
    line.map((doc, columnIndex) => {
      const localRow = rowIndex - startRow;
      const localColumn = columnIndex - startColumn;
      if (localRow < 0 || localColumn < 0) return doc;

      const sourceLine = source[localRow];
      if (!Array.isArray(sourceLine) || localColumn >= sourceLine.length) return doc;
      if (isCovered(resized.merges, rowIndex, columnIndex)) return doc;

      pastedRows = Math.max(pastedRows, localRow + 1);
      pastedColumns = Math.max(pastedColumns, localColumn + 1);
      return docFromText(String(sourceLine[localColumn] ?? ''));
    }),
  );

  return { data: { ...resized, cells }, rows: pastedRows, columns: pastedColumns };
}

/** Следующая ячейка в направлении стрелки (объединённые пропускаются). */
export function nextAnchor(data, from, direction) {
  const step = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction];
  if (!step) return from;

  let row = from.row + step[0];
  let column = from.col + step[1];

  while (row >= 0 && row < data.rows && column >= 0 && column < data.columns) {
    const anchor = anchorOf(data.merges, row, column);
    if (anchor.row !== from.row || anchor.col !== from.col) return anchor;
    row += step[0];
    column += step[1];
  }

  return from;
}

/** Соседняя ячейка по порядку обхода (Tab / Shift+Tab). */
export function nextInOrder(data, from, delta) {
  const anchors = [];
  for (let row = 0; row < data.rows; row += 1) {
    for (let column = 0; column < data.columns; column += 1) {
      if (!isCovered(data.merges, row, column)) anchors.push({ row, col: column });
    }
  }

  const index = anchors.findIndex((cell) => cell.row === from.row && cell.col === from.col);
  if (index < 0) return from;

  return anchors[Math.min(Math.max(index + delta, 0), anchors.length - 1)];
}
