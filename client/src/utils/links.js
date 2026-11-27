/**
 * Внутренние и внешние ссылки (Правка 6).
 *
 * Ссылка — это либо обычный URL (внешняя), либо переход к элементу курса
 * (внутренняя): блоку, слайду, вопросу теста, слайду памятки или термину
 * глоссария. Внутренняя ссылка хранит и готовый путь `/block/<id>?slide=…`,
 * и описание цели (`targetLabel`, `targetBadge`) — по ним просмотр рисует
 * подсказку «Ведёт на: …» и метку типа, не загружая карту курса.
 *
 * В Tiptap-тексте ссылка — метка `link` с дополнительными атрибутами
 * (components/editor/extensions/courseLink.js). В обычном тексте (пункты
 * чек-листа, подписи, код, реплика) ссылки лежат в data.links рядом с текстом:
 * { id, field, ref, from, to, word, kind, href, … }. У таблицы ячейка —
 * Tiptap-документ, поэтому ссылка там тоже метка link, а старый формат
 * (data.links с field = 'cell') переносится в метки нормализацией.
 */

import { getBlockTypeLabel } from './helpers.js';

/** Виды ссылок. */
export const LINK_KINDS = ['external', 'internal'];

/** Типы целей внутренней ссылки и их подписи. */
export const INTERNAL_TARGET_TYPES = [
  { type: 'block', label: 'Блок', icon: 'layers' },
  { type: 'slide', label: 'Слайд', icon: 'file' },
  { type: 'question', label: 'Вопрос', icon: 'clipboard' },
  { type: 'memo', label: 'Слайд памятки', icon: 'layers' },
  { type: 'term', label: 'Термин', icon: 'book' },
];

const TARGET_LABELS = new Map(INTERNAL_TARGET_TYPES.map((item) => [item.type, item.label]));

/** Подпись типа цели: «Слайд», «Вопрос», «Термин»… */
export function getTargetTypeLabel(type) {
  return TARGET_LABELS.get(type) ?? 'Элемент курса';
}

/**
 * Поля обычного текста, в которых можно поставить ссылку, по типу контента.
 * Совпадает с PLAIN_LINK_FIELDS на сервере (server/src/utils/content.js).
 * У таблицы ячейка — Tiptap-документ, поэтому список нужен только для
 * таблиц старого формата (data.links с field = 'cell').
 */
export const PLAIN_LINK_FIELDS = {
  table: ['cell'],
  checklist: ['title', 'item'],
  image: ['caption'],
  video: ['caption'],
  code: ['code'],
  replica: ['text'],
};

/** Порядок полей при обходе аннотаций: сверху вниз по карточке фрагмента. */
const PLAIN_FIELD_ORDER = ['title', 'character', 'caption', 'filename', 'code', 'text', 'cell', 'item'];

/** Предел числа ссылок в одном фрагменте. */
export const PLAIN_LINKS_LIMIT = 200;

/** Пределы длин: адрес ссылки, слово-якорь и описание цели. */
const HREF_LIMIT = 1000;
const WORD_LIMIT = 300;
const LABEL_LIMIT = 300;

let linkCounter = 0;

/** Идентификатор новой ссылки. */
export function createLinkId() {
  linkCounter += 1;
  return `link-${Date.now().toString(36)}-${linkCounter.toString(36)}`;
}

/** Внешний адрес: пустое — ошибка, «example.com» — дополняется https://. */
export function normalizeExternalHref(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(raw)) return raw;
  return `https://${raw}`;
}

/** Путь внутренней ссылки: /block/<id>?slide=<id> (или ?question=, ?memo=, ?term=). */
export function internalHref({ targetType, targetId, targetBlockId } = {}) {
  if (!targetBlockId) return '';

  if (!targetType || targetType === 'block') return `/block/${targetBlockId}`;

  const key = { slide: 'slide', question: 'question', memo: 'memo', term: 'term' }[targetType];
  if (!key || !targetId) return '';

  return `/block/${targetBlockId}?${key}=${encodeURIComponent(targetId)}`;
}

/** Внутренняя ли ссылка (считаем по виду, а не по адресу). */
export const isInternalLink = (link) => link?.kind === 'internal';

/** Подсказка ссылки: «Ведёт на: Теория → Слайд 3». */
export function linkTooltip(link) {
  return isInternalLink(link) && link?.targetLabel ? `Ведёт на: ${link.targetLabel}` : '';
}

/**
 * Описание цели в дереве курса: «Теория → Слайд 3».
 * block — блок карты курса { id, type, title }, item — { index, title }.
 */
export function buildTargetLabel(block, item, targetType) {
  if (!block) return '';
  if (!item || targetType === 'block') return block.title;

  const number = Number(item.index) + 1;

  if (targetType === 'slide') return `${block.title} → Слайд ${number}`;
  if (targetType === 'question') return `${block.title} → Вопрос ${number}`;
  if (targetType === 'memo') return `${block.title} → ${item.title || `Слайд ${number}`}`;
  if (targetType === 'term') return `${block.title} → ${item.title || 'Термин'}`;

  return block.title;
}

/** Метка типа цели в дереве: у блока — тип блока, у элемента — его вид. */
export function buildTargetBadge(block, targetType) {
  if (targetType && targetType !== 'block') return getTargetTypeLabel(targetType);
  return getBlockTypeLabel(block?.type);
}

/** Нормализация ссылки обычного текста; null — ссылка некорректна. */
export function normalizePlainLink(link) {
  if (!link || typeof link !== 'object') return null;

  const id = String(link.id ?? '').slice(0, 60);
  const field = String(link.field ?? '');
  if (!id || !PLAIN_FIELD_ORDER.includes(field)) return null;

  const targetType = String(link.targetType ?? '');
  const kind = link.kind === 'internal' || (!link.kind && targetType && targetType !== 'external') ? 'internal' : 'external';

  const href =
    kind === 'internal'
      ? String(link.href ?? '').slice(0, HREF_LIMIT) || internalHref(link)
      : normalizeExternalHref(link.href).slice(0, HREF_LIMIT);

  if (!href) return null;

  const from = Math.floor(Number(link.from));
  const to = Math.floor(Number(link.to));

  return {
    id,
    field,
    ref: String(link.ref ?? '').slice(0, 60),
    from: Number.isFinite(from) && from > 0 ? from : 0,
    to: Number.isFinite(to) && to > 0 ? to : 0,
    word: String(link.word ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, WORD_LIMIT),
    kind,
    href,
    targetType: kind === 'internal' ? targetType : '',
    targetId: kind === 'internal' ? String(link.targetId ?? '').slice(0, 60) : '',
    targetBlockId: kind === 'internal' ? String(link.targetBlockId ?? '').slice(0, 60) : '',
    targetLabel: kind === 'internal' ? String(link.targetLabel ?? '').slice(0, LABEL_LIMIT) : '',
    targetBadge: kind === 'internal' ? String(link.targetBadge ?? '').slice(0, 40) : '',
    newTab: kind === 'external' ? Boolean(link.newTab) : false,
  };
}

/** Новая ссылка обычного текста. */
export function createPlainLink({ field, ref = '', from = 0, to = 0, word = '', ...rest }) {
  return normalizePlainLink({ ...rest, id: createLinkId(), field, ref, from, to, word });
}

/** Ссылки фрагмента в порядке появления: [{ id, field, ref, from, to, word, … }]. */
export function collectPlainLinks(data) {
  const source = Array.isArray(data?.links) ? data.links : [];
  return source
    .map(normalizePlainLink)
    .filter(Boolean)
    .slice(0, PLAIN_LINKS_LIMIT);
}

/** Ссылки конкретного поля (ячейки, пункта, подписи). */
export function linksForField(links = [], field, ref = '') {
  return (links ?? []).filter((link) => link.field === field && String(link.ref ?? '') === String(ref ?? ''));
}

/** Добавить ссылку к массиву data.links. */
export function addPlainLink(links = [], link) {
  const list = Array.isArray(links) ? links : [];
  if (!link || list.length >= PLAIN_LINKS_LIMIT) return list;
  return [...list, link];
}

/** Удалить ссылку из массива data.links. */
export function removePlainLink(links = [], linkId) {
  return (links ?? []).filter((link) => link.id !== linkId);
}

/** Ссылка в виде атрибутов Tiptap-метки link (без field/ref/from/to/word). */
export function linkToMarkAttrs(link) {
  return {
    href: link.href,
    linkKind: link.kind,
    targetType: link.targetType ?? '',
    targetId: link.targetId ?? '',
    targetBlockId: link.targetBlockId ?? '',
    targetLabel: link.targetLabel ?? '',
    targetBadge: link.targetBadge ?? '',
    newTab: Boolean(link.newTab),
  };
}

/**
 * Поставить или изменить ссылку на слово в обычном тексте (Правка 6).
 *
 * Если автор поменял текст ссылки в диалоге, он заменяется прямо в строке,
 * а диапазоны примечаний и остальных ссылок этого поля сдвигаются.
 * При изменении ссылки диапазон проверяется по сохранённому `word`: поле
 * могли править вручную, тогда слово ищется заново.
 * Возвращает { value, links, notes, delta } или null, если ссылку поставить нельзя.
 * Чистая функция — её проверяет scripts/editor-check.mjs.
 */
export function applyPlainLink({
  value = '',
  notes = [],
  links = [],
  field,
  ref = '',
  from = 0,
  to = 0,
  label = '',
  payload,
  editingId = null,
}) {
  const text = String(value ?? '');
  const editing = editingId ? (links ?? []).find((link) => link.id === editingId) : null;

  let start = Number(from);
  let end = Number(to);
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = start;

  // Сохранённый диапазон мог съехать после ручной правки — ищем слово заново
  const anchor = String(editing?.word ?? '').trim();
  if (anchor && text.slice(start, end) !== anchor) {
    const index = text.indexOf(anchor);
    if (index >= 0) {
      start = index;
      end = index + anchor.length;
    }
  }

  const word = String(label ?? '').trim() || text.slice(start, end);

  if (!word) return null;
  if (start === end && !editingId) return null;

  let nextValue = text;
  let delta = 0;

  if (word !== nextValue.slice(start, end)) {
    nextValue = `${nextValue.slice(0, start)}${word}${nextValue.slice(end)}`;
    delta = word.length - (end - start);
  }

  /**
   * Сдвиг аннотаций того же поля. Совпадающая с заменой аннотация (примечание
   * на том же слове) растягивается вместе со словом, а не уезжает за него.
   */
  const adjust = (entries) =>
    (entries ?? []).map((entry) => {
      if (String(entry.field) !== String(field) || String(entry.ref ?? '') !== String(ref ?? '')) return entry;

      const entryFrom = Number(entry.from);
      const entryTo = Number(entry.to);
      if (!delta || !Number.isFinite(entryFrom) || !Number.isFinite(entryTo)) return entry;

      if (entryTo <= start) return entry;
      if (entryFrom >= end) return { ...entry, from: entryFrom + delta, to: entryTo + delta };
      if (entryFrom >= start && entryTo <= end) return { ...entry, from: entryFrom, to: entryTo + delta };

      // Диапазон пересекает замену частично — аннотация найдётся по word
      return entry;
    });

  const nextLinks = adjust(links).filter((link) => link.id !== editingId);
  const nextNotes = adjust(notes);

  const link = normalizePlainLink({
    ...payload,
    id: editingId ?? createLinkId(),
    field,
    ref,
    from: start,
    to: start + word.length,
    word,
  });

  if (!link) return null;

  return { value: nextValue, links: [...nextLinks, link], notes: nextNotes, delta };
}
