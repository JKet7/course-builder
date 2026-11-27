/**
 * Справка о блоке (Правка 7).
 *
 * Собирает по курсу две вещи, не загружая карту ссылок:
 * - сноски (примечания) самого блока — с номером, текстом и местом
 *   («слайд 2», «вопрос 3», «слайд 1», «термин «…»»), чтобы автор видел
 *   все пояснения сразу и мог перейти к нужному месту;
 * - обратные ссылки — где этот блок упоминается (внутренние ссылки
 *   из других блоков курса, поставленные в Правке 6).
 *
 * Модуль чистый: работает с объектами Prisma (или их копиями), в базу не
 * ходит. Поэтому его проверяет server/scripts/check-help.mjs без сервера.
 */

import { contentBodyItems } from './contentBody.js';

/** Сколько примечаний и упоминаний отдаём в одном ответе. */
export const HELP_LIMIT = 300;

/** Предел длины текста примечания или названия в ответе. */
const TEXT_LIMIT = 300;

/** Однострочный текст: без переводов строк и лишних пробелов. */
function clip(value, max = TEXT_LIMIT) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Обход Tiptap JSON в порядке документа. */
function walkDoc(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (!Array.isArray(node.content)) return;
  for (const child of node.content) walkDoc(child, visit);
}

/**
 * Примечания из Tiptap-документа (метка inlineNote, Правка 5).
 * Одно примечание может стоять на нескольких словах — берём первое.
 */
export function collectDocNotes(doc) {
  const notes = [];
  const seen = new Set();

  walkDoc(doc, (node) => {
    const marks = Array.isArray(node?.marks) ? node.marks : [];
    for (const mark of marks) {
      if (mark?.type !== 'inlineNote') continue;

      const noteId = String(mark.attrs?.noteId ?? '').trim();
      const text = clip(mark.attrs?.text);
      if (!noteId || !text || seen.has(noteId)) continue;

      seen.add(noteId);
      notes.push({ noteId, text });
    }
  });

  return notes;
}

/** Внутренние ссылки из Tiptap-документа (метка link, Правка 6). */
export function collectDocLinks(doc) {
  const links = [];
  const seen = new Set();

  walkDoc(doc, (node) => {
    const marks = Array.isArray(node?.marks) ? node.marks : [];
    for (const mark of marks) {
      if (mark?.type !== 'link') continue;

      const attrs = mark.attrs ?? {};
      if (attrs.linkKind !== 'internal' || !attrs.targetBlockId) continue;

      const key = [attrs.targetBlockId, attrs.targetType ?? '', attrs.targetId ?? '', attrs.targetLabel ?? ''].join('|');
      if (seen.has(key)) continue;

      seen.add(key);
      links.push({
        targetType: attrs.targetType || 'block',
        targetId: attrs.targetId ?? '',
        targetBlockId: attrs.targetBlockId,
        targetLabel: clip(attrs.targetLabel, 200),
      });
    }
  });

  return links;
}

/** Примечания обычного текста: data.notes у таблицы, чек-листа, кода и т. д. */
export function collectPlainNotes(data) {
  const notes = Array.isArray(data?.notes) ? data.notes : [];

  return notes
    .map((note) => ({ noteId: String(note?.id ?? '').trim(), text: clip(note?.text) }))
    .filter((note) => note.noteId && note.text);
}

/** Внутренние ссылки обычного текста: data.links. */
export function collectPlainLinks(data) {
  const links = Array.isArray(data?.links) ? data.links : [];

  return links
    .filter((link) => link?.kind === 'internal' && link?.targetBlockId)
    .map((link) => ({
      targetType: link.targetType || 'block',
      targetId: link.targetId ?? '',
      targetBlockId: link.targetBlockId,
      targetLabel: clip(link.targetLabel, 200),
    }));
}

/**
 * Данные фрагмента и документы ячеек таблицы: примечания и ссылки ячейки
 * живут метками внутри документа (data.cells), а у таблиц старого формата —
 * в data.notes/data.links, поэтому в список попадают оба.
 */
function contentItems(content) {
  const data = content?.data;
  if (content?.type !== 'table') return [data];

  const cells = Array.isArray(data?.cells) ? data.cells : [];
  return [data, ...cells.flatMap((row) => (Array.isArray(row) ? row : []))];
}

/** Места блока, где могут стоять примечания и ссылки: место + адрес перехода. */
function blockPlaces(block) {
  const blockId = String(block?.id ?? '');

  if (block?.type === 'theory') {
    return (block.slides ?? []).map((slide, index) => ({
      place: `слайд ${index + 1}`,
      href: `/block/${blockId}?slide=${encodeURIComponent(slide.id)}`,
      items: (slide.contents ?? []).flatMap(contentItems),
    }));
  }

  if (block?.type === 'test') {
    return (block.questions ?? []).map((question, index) => ({
      place: `вопрос ${index + 1}`,
      href: `/block/${blockId}?question=${encodeURIComponent(question.id)}`,
      items: [question.explanation],
    }));
  }

  if (block?.type === 'memo') {
    return (block.memoSlides ?? []).flatMap((slide, slideIndex) =>
      (slide.cells ?? []).map((cell, cellIndex) => ({
        place: `слайд ${slideIndex + 1}, карточка ${cellIndex + 1}`,
        href: `/block/${blockId}?memo=${encodeURIComponent(cell.id)}`,
        items: [
          // Заголовок карточки — тоже Tiptap-документ: ссылки и примечания
          // в нём должны попадать в справку наравне с телом.
          ...(cell.titleDoc?.type === 'doc' ? [cell.titleDoc] : []),
          ...contentBodyItems(cell.body).flatMap(contentItems),
        ],
      })),
    );
  }

  if (block?.type === 'glossary') {
    return (block.terms ?? []).map((term) => ({
      place: `термин «${clip(term.term, 60)}»`,
      href: `/block/${blockId}?term=${encodeURIComponent(term.id)}`,
      items: contentBodyItems(term.definition).flatMap(contentItems),
    }));
  }

  return [];
}

/**
 * Примечания блока по порядку: слайды и фрагменты, вопросы, слайды памятки, термины.
 * Возвращает [{ noteId, text, place, href }] — href ведёт к месту примечания.
 */
export function collectBlockNotes(block) {
  const notes = [];
  const seen = new Set();

  for (const spot of blockPlaces(block)) {
    for (const data of spot.items) {
      const found = [...collectDocNotes(data), ...collectPlainNotes(data)];

      for (const note of found) {
        if (seen.has(note.noteId)) continue;
        seen.add(note.noteId);
        notes.push({ noteId: note.noteId, text: note.text, place: spot.place, href: spot.href });
      }
    }
  }

  return notes;
}

/**
 * Где блок упоминается: внутренние ссылки из других блоков курса.
 * Ссылки из самого блока не считаются — «упоминается в себе» бесполезно.
 * Возвращает [{ blockId, blockTitle, blockType, place, href }].
 */
export function collectBlockMentions(course, targetBlockId) {
  const target = String(targetBlockId ?? '');
  if (!target) return [];

  const mentions = [];
  const seen = new Set();

  for (const block of course?.blocks ?? []) {
    if (!block || block.id === target) continue;

    for (const spot of blockPlaces(block)) {
      const links = spot.items.flatMap((data) => [...collectDocLinks(data), ...collectPlainLinks(data)]);
      if (!links.some((link) => link.targetBlockId === target)) continue;

      const key = `${block.id}|${spot.place}`;
      if (seen.has(key)) continue;

      seen.add(key);
      mentions.push({
        blockId: block.id,
        blockTitle: clip(block.title, 200),
        blockType: block.type,
        place: spot.place,
        href: spot.href,
      });
    }
  }

  return mentions;
}

/**
 * Дата последнего изменения блока.
 * У фрагментов теории есть updatedAt, поэтому для неё берём максимум
 * из блока и его контента; у теста, памятки и глоссария — дату блока.
 */
export function blockUpdatedAt(block) {
  const stamps = [block?.updatedAt];

  for (const slide of block?.slides ?? []) {
    for (const content of slide.contents ?? []) stamps.push(content?.updatedAt);
  }

  const times = stamps
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));

  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

/** Ответ GET /api/blocks/:id/help. */
export function buildBlockHelp(block, course) {
  if (!block) return null;

  const notes = collectBlockNotes(block);
  const mentions = collectBlockMentions(course, block.id);

  return {
    block: { id: block.id, title: block.title, type: block.type },
    updatedAt: blockUpdatedAt(block),
    notes: notes.slice(0, HELP_LIMIT).map((note, index) => ({ number: index + 1, ...note })),
    mentions: mentions.slice(0, HELP_LIMIT),
    totals: { notes: notes.length, mentions: mentions.length },
  };
}

/**
 * Что выбрать из курса для справки: все блоки с местами примечаний и ссылок.
 * По смыслу совпадает с картой ссылок (utils/linkMap.js), но там только
 * заголовки, а здесь нужны ещё примечания и обратные ссылки.
 */
export const HELP_COURSE_SELECT = {
  id: true,
  title: true,
  blocks: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      title: true,
      order: true,
      updatedAt: true,
      slides: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          order: true,
          contents: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true, type: true, data: true, order: true, updatedAt: true },
          },
        },
      },
      questions: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: { id: true, explanation: true, order: true },
      },
      memoSlides: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          order: true,
          cells: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true, title: true, titleDoc: true, body: true, order: true },
          },
        },
      },
      terms: {
        orderBy: [{ term: 'asc' }, { id: 'asc' }],
        select: { id: true, term: true, definition: true },
      },
    },
  },
};
