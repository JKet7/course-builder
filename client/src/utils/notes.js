/**
 * Примечания к тексту (Правка 5).
 *
 * Примечание — это метка inlineNote на слове или фразе: attrs.noteId (идентификатор)
 * и attrs.text (короткий текст, как в Wiki). Номер примечания в документе не хранится:
 * он вычисляется по порядку появления метки — так же, как номера списков в Правке 4, —
 * поэтому после удаления одного примечания остальные перенумеровываются сами.
 *
 * Номера сквозные по слайду: collectSlideNotes считает, сколько примечаний было
 * в предыдущих фрагментах, и отдаёт смещение (offsetById) редактору и просмотру.
 *
 * Модуль работает с Tiptap JSON и используется редактором (плагин декораций
 * в components/editor/extensions/inlineNote.js), и просмотром/печатью
 * (ContentRenderer): annotateNotes проставляет в копию документа noteNumber,
 * noteText и noteMarker (признак «после этого слова рисуем номер»).
 *
 * У фрагментов без Tiptap (чек-лист, картинка, видео, код, реплика)
 * примечания хранятся в data.notes: { id, text, field, ref, from, to, word }.
 * Их читают collectPlainNotes/splitNoteText, а нумерует тот же collectSlideNotes.
 * В таблице ячейка — Tiptap-документ, поэтому её примечания — метки (collectNotes),
 * а старый формат (data.notes с field = 'cell') переносится в метки нормализацией.
 *
 * У картинки есть ещё маркеры — те же примечания с field = 'marker', но привязанные
 * не к слову, а к точке изображения (x/y в процентах). Поэтому маркеры нумеруются
 * вместе с остальными примечаниями слайда и попадают в справку о блоке.
 */

import { placeTextRanges, splitByRanges } from './plainText.js';
import { normalizeTableData } from './table.js';

/** Тип метки примечания в Tiptap JSON. */
export const NOTE_MARK_TYPE = 'inlineNote';

/** Поле примечания-маркера на картинке (координаты x/y в процентах, см. utils/image.js). */
export const IMAGE_MARKER_FIELD = 'marker';

/** Предел длины примечания: в интерфейсе ожидается короткое предложение. */
export const NOTE_MAX_LENGTH = 300;

/** Идентификатор нового примечания. */
export function createNoteId() {
  return `note-${Math.random().toString(36).slice(2, 10)}`;
}

/** Текст примечания без лишних пробелов и с ограничением длины. */
export function normalizeNoteText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX_LENGTH);
}

/**
 * Примечания документа в порядке появления.
 * content — Tiptap-документ или его content.
 *
 * Возвращает [{ noteId, number, text }]: номер — сквозной по документу,
 * текст — первый непустой из всех вхождений метки (метка может разрываться
 * другой разметкой, например жирным словом внутри фразы).
 */
export function collectNotes(content) {
  const nodes = Array.isArray(content) ? content : content?.content ?? [];
  const notes = new Map();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark?.type !== NOTE_MARK_TYPE) continue;

        const noteId = mark.attrs?.noteId;
        if (!noteId) continue;

        const text = normalizeNoteText(mark.attrs?.text ?? '');
        const note = notes.get(noteId);

        if (!note) notes.set(noteId, { noteId, number: notes.size + 1, text });
        else if (text) note.text = text;
      }

      return;
    }

    (node.content ?? []).forEach(walk);
  };

  nodes.forEach(walk);
  return [...notes.values()];
}

/**
 * Копия документа с вычисленными номерами примечаний.
 * Каждая метка получает attrs.noteNumber и attrs.noteText, а последнее вхождение
 * метки — ещё и noteMarker: просмотр и печать рисуют номер именно после этого слова.
 * startNumber — сколько примечаний уже было на слайде до этого фрагмента:
 * номера сквозные по слайду, а не по отдельному документу.
 * Используется ContentRenderer.
 */
export function annotateNotes(doc, startNumber = 0) {
  if (!doc || doc.type !== 'doc') return doc;

  const notes = collectNotes(doc);
  if (notes.length === 0) return doc;

  const byId = new Map(notes.map((note) => [note.noteId, note]));
  const left = new Map();

  const countNodes = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark?.type !== NOTE_MARK_TYPE) continue;

        const noteId = mark.attrs?.noteId;
        if (noteId) left.set(noteId, (left.get(noteId) ?? 0) + 1);
      }

      return;
    }

    (node.content ?? []).forEach(countNodes);
  };

  (doc.content ?? []).forEach(countNodes);

  const cloneNode = (node) => {
    const result = { ...node };

    if (node.type === 'text' && Array.isArray(node.marks)) {
      result.marks = node.marks.map((mark) => {
        if (mark?.type !== NOTE_MARK_TYPE) return mark;

        const noteId = mark.attrs?.noteId;
        const note = byId.get(noteId);
        if (!note) return mark;

        const remaining = (left.get(noteId) ?? 1) - 1;
        left.set(noteId, remaining);

        return {
          ...mark,
          attrs: {
            ...(mark.attrs ?? {}),
            noteNumber: note.number + startNumber,
            noteText: note.text,
            noteMarker: remaining === 0,
          },
        };
      });
    }

    if (Array.isArray(node.content)) result.content = node.content.map(cloneNode);

    return result;
  };

  return { ...doc, content: (doc.content ?? []).map(cloneNode) };
}

/* ------------------------------------------- Примечания в обычном тексте (без Tiptap) */

/**
 * Поля обычного текста, к которым можно привязать примечание, по типу контента.
 * В таблице и чек-листе это ячейки и пункты, у картинки, видео, кода и реплики —
 * подпись/текст. У «Текста» и «Важного» примечания живут метками Tiptap (выше).
 */
export const PLAIN_NOTE_FIELDS = {
  table: ['cell'],
  checklist: ['title', 'item'],
  image: [IMAGE_MARKER_FIELD, 'caption'],
  video: ['caption'],
  code: ['code'],
  replica: ['text'],
};

/** Порядок полей при нумерации: сверху вниз по карточке фрагмента. */
const PLAIN_FIELD_ORDER = [
  IMAGE_MARKER_FIELD,
  'title',
  'character',
  'caption',
  'filename',
  'code',
  'text',
  'cell',
  'item',
];

/** Предел числа примечаний в одном фрагменте. */
export const PLAIN_NOTES_LIMIT = 200;

/** Предел длины слова-якоря. */
const PLAIN_NOTE_WORD_LIMIT = 300;

/**
 * Примечание обычного текста: { id, text, field, ref, from, to, word }.
 * ref — координаты ячейки «строка-колонка» или id пункта чек-листа,
 * from/to — диапазон слова в тексте поля (нужен, чтобы подчеркнуть именно его).
 * У маркера картинки вместо диапазона — точка { x, y } в процентах.
 */
export function normalizePlainNote(note) {
  if (!note || typeof note !== 'object') return null;

  const id = String(note.id ?? '').slice(0, 60);
  const text = normalizeNoteText(note.text ?? '');
  const field = String(note.field ?? '');
  const ref = String(note.ref ?? '').slice(0, 60);
  const word = String(note.word ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLAIN_NOTE_WORD_LIMIT);
  const from = Math.floor(Number(note.from));
  const to = Math.floor(Number(note.to));

  if (!id || !text || !PLAIN_FIELD_ORDER.includes(field)) return null;

  return {
    id,
    text,
    field,
    ref,
    from: Number.isFinite(from) && from > 0 ? from : 0,
    to: Number.isFinite(to) && to > 0 ? to : 0,
    word,
    ...(field === IMAGE_MARKER_FIELD
      ? { x: normalizeMarkerPoint(note.x), y: normalizeMarkerPoint(note.y) }
      : {}),
  };
}

/** Координата маркера в процентах от картинки: 0–100, один знак после запятой. */
function normalizeMarkerPoint(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
}

/** Новое примечание обычного текста (у маркера картинки ещё x и y в процентах). */
export function createPlainNote({ field, ref = '', from = 0, to = 0, word = '', text, x, y }) {
  return normalizePlainNote({ id: createNoteId(), text, field, ref, from, to, word, x, y });
}

/** Порядок примечаний внутри фрагмента: поля сверху вниз, затем ячейки и пункты. */
function sortPlainNotes(notes, data) {
  const fieldIndex = (note) => {
    const index = PLAIN_FIELD_ORDER.indexOf(note.field);
    return index < 0 ? PLAIN_FIELD_ORDER.length : index;
  };

  const refIndex = (note) => {
    if (note.field === 'cell') {
      const [row, column] = String(note.ref).split('-').map(Number);
      return (Number.isFinite(row) ? row : 0) * 1000 + (Number.isFinite(column) ? column : 0);
    }

    if (note.field === 'item') {
      const items = Array.isArray(data?.items) ? data.items : [];
      const index = items.findIndex((item) => String(item?.id ?? '') === note.ref);
      return index < 0 ? items.length : index;
    }

    // Диалог: примечания реплик идут сверху вниз, как они стоят на слайде
    if (note.field === 'text' && Array.isArray(data?.lines)) {
      const index = data.lines.findIndex((line) => String(line?.id ?? '') === note.ref);
      return index < 0 ? data.lines.length : index;
    }

    return 0;
  };

  return [...notes].sort((a, b) => fieldIndex(a) - fieldIndex(b) || refIndex(a) - refIndex(b) || a.from - b.from);
}

/** Примечания фрагмента в порядке появления: [{ id, text, field, ref, from, to, word }]. */
export function collectPlainNotes(data) {
  const source = Array.isArray(data?.notes) ? data.notes : [];
  const notes = source
    .map(normalizePlainNote)
    .filter(Boolean)
    .slice(0, PLAIN_NOTES_LIMIT);

  return sortPlainNotes(notes, data);
}

/** Номера примечаний фрагмента: Map(id → номер). offset — примечания предыдущих фрагментов. */
export function plainNoteNumbers(data, offset = 0) {
  const numbers = new Map();
  collectPlainNotes(data).forEach((note, index) => numbers.set(note.id, offset + index + 1));
  return numbers;
}

/** Примечания конкретного поля (ячейки, пункта, подписи). */
export function notesForField(notes = [], field, ref = '') {
  return (notes ?? []).filter((note) => note.field === field && String(note.ref ?? '') === String(ref ?? ''));
}

/** Добавить примечание к массиву data.notes. */
export function addPlainNote(notes = [], note) {
  const list = Array.isArray(notes) ? notes : [];
  if (!note || list.length >= PLAIN_NOTES_LIMIT) return list;
  return [...list, note];
}

/** Изменить текст примечания в массиве data.notes. */
export function setPlainNoteText(notes = [], noteId, rawText) {
  const text = normalizeNoteText(rawText);
  if (!text) return notes ?? [];
  return (notes ?? []).map((note) => (note.id === noteId ? { ...note, text } : note));
}

/** Удалить примечание из массива data.notes — нумерация пересчитается сама. */
export function removePlainNote(notes = [], noteId) {
  return (notes ?? []).filter((note) => note.id !== noteId);
}

/**
 * Текст поля, разбитый на куски с примечаниями.
 * Возвращает [{ text, note }]: у куска с примечанием note — само примечание.
 * Если сохранённый диапазон не совпадает с текстом (поле правили), слово ищется
 * заново по сохранённому word; если и его нет — номер ставится в конце текста.
 * Разметка диапазонов общая со ссылками (utils/plainText.js).
 */
export function splitNoteText(value, notes = []) {
  return splitByRanges(value, placeTextRanges(value, notes)).map((part) => ({
    text: part.text,
    note: part.item,
  }));
}

/**
 * Примечания фрагмента контента в порядке появления: [{ noteId, text }].
 * Текст и «Важное» — метки Tiptap, таблица — метки в документах ячеек,
 * остальные типы — data.notes.
 */
export function collectContentNotes(content) {
  if (!content) return [];

  if (content.type === 'text' || content.type === 'important') {
    return collectNotes(content.data).map((note) => ({ noteId: note.noteId, text: note.text }));
  }

  if (content.type === 'table') {
    // Ячейки — Tiptap-документы; старый формат (строки + data.notes)
    // нормализация переносит в метки, поэтому порядок номеров сохраняется.
    const cells = normalizeTableData(content.data).cells ?? [];

    return cells
      .flatMap((row) => row.flatMap((doc) => collectNotes(doc)))
      .map((note) => ({ noteId: note.noteId, text: note.text }));
  }

  return collectPlainNotes(content.data).map((note) => ({ noteId: note.id, text: note.text }));
}

/** Сколько примечаний во фрагменте. */
export function countContentNotes(content) {
  return collectContentNotes(content).length;
}

/**
 * Нумерация примечаний всего слайда (Правка 5): номера сквозные по фрагментам.
 * offset — сколько примечаний уже было до этого набора (например, в заголовке
 * карточки памятки). Возвращает { numberById, offsetById, total }: offsetById —
 * сколько примечаний было до фрагмента, его получают ContentRenderer
 * (просмотр/печать) и TiptapEditor.
 */
export function collectSlideNotes(contents = [], offset = 0) {
  const numberById = new Map();
  const offsetById = new Map();
  let total = Math.max(0, Number(offset) || 0);

  for (const content of contents ?? []) {
    if (!content) continue;

    offsetById.set(content.id, total);

    for (const note of collectContentNotes(content)) {
      total += 1;
      numberById.set(note.noteId, total);
    }
  }

  return { numberById, offsetById, total };
}
