/**
 * Многоуровневые списки (Правка 4).
 *
 * Номера пунктов НЕ хранятся в тексте: они выводятся из структуры документа
 * (вложенность listItem внутри bulletList/orderedList). Один и тот же алгоритм
 * используют редактор (плагин декораций Tiptap) и просмотр/печать (ContentRenderer),
 * поэтому нумерация в редакторе и в готовом курсе всегда совпадает.
 *
 * Модель:
 * - уровень пункта = глубина вложенности (0..8, всего 9 уровней, как в Word);
 * - счётчики живут в рамках одного верхнего списка, поэтому списки нумеруются
 *   независимо (второй начинается с 1, а не продолжает первый);
 * - конфигурация уровней хранится в атрибуте `levels` верхнего списка,
 *   `listId` — идентификатор списка (нужен экспорту и проверкам).
 */

export const MAX_LIST_LEVELS = 9;

/** Отступ по умолчанию (em) для каждого уровня. */
const DEFAULT_INDENT = 1.9;

/** Стили нумерации: подписи для окна настройки списка. */
export const LIST_NUMBER_STYLES = [
  { value: 'decimal', label: '1, 2, 3' },
  { value: 'lower-alpha', label: 'a, b, c' },
  { value: 'upper-alpha', label: 'A, B, C' },
  { value: 'lower-roman', label: 'i, ii, iii' },
  { value: 'upper-roman', label: 'I, II, III' },
];

/** Символы маркеров для маркированных уровней. */
export const LIST_BULLET_MARKERS = ['•', '–', '*', '·', '◦'];

/** Варианты суффикса после номера. */
export const LIST_SUFFIXES = [
  { value: '.', label: '1.' },
  { value: ')', label: '1)' },
  { value: '', label: '1' },
];

/** Типы узлов списка в Tiptap JSON. */
export const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList']);

const ROMAN_PARTS = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Римская запись числа (для стилей i / I). */
export function toRoman(value) {
  let rest = Math.max(1, Math.round(Number(value) || 1));
  let result = '';

  for (const [weight, symbol] of ROMAN_PARTS) {
    while (rest >= weight) {
      result += symbol;
      rest -= weight;
    }
  }

  return result;
}

/** Буквенная запись числа: 1 → A, 26 → Z, 27 → AA. */
export function toAlpha(value) {
  let rest = Math.max(1, Math.round(Number(value) || 1));
  let result = '';

  while (rest > 0) {
    const index = (rest - 1) % 26;
    result = String.fromCharCode(65 + index) + result;
    rest = Math.floor((rest - 1) / 26);
  }

  return result;
}

/** Номер пункта в выбранном стиле (без суффикса). */
export function formatListNumber(value, style = 'decimal') {
  switch (style) {
    case 'lower-alpha':
      return toAlpha(value).toLowerCase();
    case 'upper-alpha':
      return toAlpha(value);
    case 'lower-roman':
      return toRoman(value).toLowerCase();
    case 'upper-roman':
      return toRoman(value);
    default:
      return String(Math.max(1, Math.round(Number(value) || 1)));
  }
}

/**
 * Уровни по умолчанию: сквозная иерархия «1., 1.1., 1.1.1., …».
 * Шаблон уровня — строка с подстановками %1..%9 (номер соответствующего уровня).
 */
export const DEFAULT_LIST_LEVELS = Array.from({ length: MAX_LIST_LEVELS }, (_, index) => ({
  kind: 'ordered',
  style: 'decimal',
  template: Array.from({ length: index + 1 }, (_, part) => `%${part + 1}`).join('.'),
  suffix: '.',
  marker: LIST_BULLET_MARKERS[index % LIST_BULLET_MARKERS.length],
  indent: DEFAULT_INDENT,
  start: 1,
}));

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
};

/** Нормализация одного уровня: значения приводятся к допустимым. */
export function normalizeListLevel(level, index = 0) {
  const base = DEFAULT_LIST_LEVELS[Math.min(Math.max(index, 0), MAX_LIST_LEVELS - 1)];
  if (!level || typeof level !== 'object') return { ...base };

  const style = LIST_NUMBER_STYLES.some((item) => item.value === level.style) ? level.style : base.style;
  const template =
    typeof level.template === 'string' && level.template.trim() ? level.template.trim().slice(0, 40) : base.template;
  const suffix = typeof level.suffix === 'string' ? level.suffix.slice(0, 2) : base.suffix;
  const marker =
    typeof level.marker === 'string' && level.marker.trim() ? level.marker.trim().slice(0, 2) : base.marker;
  const start = Number(level.start);

  return {
    kind: level.kind === 'bullet' ? 'bullet' : 'ordered',
    style,
    template,
    suffix,
    marker,
    indent: Math.round(clamp(level.indent, 0.8, 6, base.indent) * 100) / 100,
    start: Number.isFinite(start) ? Math.min(Math.max(Math.round(start), 1), 999) : base.start,
  };
}

/** Конфигурация всех 9 уровней (недостающие берутся по умолчанию). */
export function normalizeListLevels(levels) {
  const source = Array.isArray(levels) ? levels : [];
  return Array.from({ length: MAX_LIST_LEVELS }, (_, index) => normalizeListLevel(source[index], index));
}

/** Конфигурация уровней из атрибутов узла списка. */
export function listLevelsFromNode(node) {
  return normalizeListLevels(node?.attrs?.levels);
}

/**
 * Готовый маркер пункта: «1.2.» для нумерованного уровня, «•» — для маркированного.
 * counters — массив счётчиков уровней (0 — уровень ещё не использован).
 * kind — тип списка: явный bulletList всегда показывает маркер, даже если
 * в настройках уровня выбран номер.
 */
export function buildListMarker(level, counters = [], kind = level.kind) {
  if (kind === 'bullet') return level.marker;

  const body = level.template.replace(/%([1-9])/g, (match, digit) => {
    const value = Number(counters[Number(digit) - 1]) || 0;
    return value > 0 ? formatListNumber(value, level.style) : '';
  });

  // Шаблон может заканчиваться точкой, а суффикс добавляется отдельно
  return `${body.replace(/\.+$/, '')}${level.suffix}`;
}

/**
 * Пересчёт нумерации.
 *
 * content — Tiptap-документ или его content;
 * listId — если задан, вернуть пункты только этого списка (иначе все списки документа).
 *
 * Возвращает { items, lists }:
 *   items: [{ path, level, label, kind, indent, listId }]
 *   lists: [{ path, level, indent, listId }]
 * path — путь до узла в виде массива индексов от корня документа.
 */
export function collectListNumbering(content, listId = null) {
  const nodes = Array.isArray(content) ? content : content?.content ?? [];
  const items = [];
  const lists = [];

  const walkList = (listNode, path, depth, parentState) => {
    const state =
      depth === 0
        ? {
            id: listNode.attrs?.listId ?? null,
            levels: listLevelsFromNode(listNode),
            counters: new Array(MAX_LIST_LEVELS).fill(0),
          }
        : parentState;

    const levelIndex = Math.min(depth, MAX_LIST_LEVELS - 1);
    const level = state.levels[levelIndex];
    const kind = listNode.type === 'bulletList' || level.kind === 'bullet' ? 'bullet' : 'ordered';
    const visible = listId === null || state.id === listId;

    if (visible) lists.push({ path, level: depth, indent: level.indent, listId: state.id });

    (listNode.content ?? []).forEach((item, index) => {
      if (item.type !== 'listItem') return;

      const itemPath = [...path, index];
      // Маркированные уровни не участвуют в нумерации: их счётчик не растёт
      if (kind === 'ordered') {
        state.counters[levelIndex] += 1;
        if (state.counters[levelIndex] === 1) state.counters[levelIndex] = level.start;
      }
      for (let deeper = levelIndex + 1; deeper < MAX_LIST_LEVELS; deeper += 1) state.counters[deeper] = 0;

      if (visible) {
        items.push({
          path: itemPath,
          level: depth,
          label: buildListMarker(level, state.counters, kind),
          kind,
          indent: level.indent,
          listId: state.id,
        });
      }

      (item.content ?? []).forEach((child, childIndex) => {
        if (LIST_NODE_TYPES.has(child.type)) walkList(child, [...itemPath, childIndex], depth + 1, state);
      });
    });
  };

  nodes.forEach((node, index) => {
    if (LIST_NODE_TYPES.has(node.type)) walkList(node, [index], 0, null);
  });

  return { items, lists };
}

/** Пункты нумерации (короткий вариант collectListNumbering). */
export function computeNumbering(content, listId = null) {
  return collectListNumbering(content, listId).items;
}

/**
 * Копия документа с вычисленными подписями пунктов:
 * listItem получает attrs.listLabel/listLevel, список — attrs.listIndent.
 * Используется просмотром и печатью (ContentRenderer).
 */
export function annotateListNumbering(doc) {
  if (!doc || doc.type !== 'doc') return doc;

  const { items, lists } = collectListNumbering(doc.content);
  const itemMap = new Map(items.map((item) => [item.path.join('.'), item]));
  const listMap = new Map(lists.map((list) => [list.path.join('.'), list]));

  const cloneNode = (node, path) => {
    const key = path.join('.');
    const attrs = { ...(node.attrs ?? {}) };

    const item = itemMap.get(key);
    if (item) {
      attrs.listLabel = item.label;
      attrs.listLevel = item.level;
      attrs.listIndent = item.indent;
    }

    const list = listMap.get(key);
    if (list) {
      attrs.listIndent = list.indent;
      attrs.listLevel = list.level;
    }

    const result = { ...node };
    if (Object.keys(attrs).length > 0) result.attrs = attrs;
    if (node.content) result.content = node.content.map((child, index) => cloneNode(child, [...path, index]));

    return result;
  };

  return { ...doc, content: (doc.content ?? []).map((node, index) => cloneNode(node, [index])) };
}

/** Идентификатор нового списка. */
export function createListId() {
  return `list-${Math.random().toString(36).slice(2, 10)}`;
}

