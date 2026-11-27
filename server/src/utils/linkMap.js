/**
 * Карта курса для диалога внутренних ссылок (Правка 6).
 *
 * Диалогу нужно дерево «курс → блок → слайды / вопросы / ячейки / термины»,
 * чтобы автор выбрал цель. Один запрос возвращает компактные подписи
 * (без контента), поэтому карта грузится быстро и кешируется на клиенте.
 */

/** Текст вопроса в одну строку, не длиннее limit. */
function questionTitle(question, limit = 90) {
  const data = question?.data && typeof question.data === 'object' ? question.data : {};
  const text = String(data.text ?? data.front ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const LINK_SLIDE_SELECT = { id: true, title: true, order: true };
const LINK_QUESTION_SELECT = { id: true, data: true, order: true };
const LINK_MEMO_SELECT = { id: true, title: true, order: true };
const LINK_MEMO_SLIDE_SELECT = {
  id: true,
  title: true,
  order: true,
  cells: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: LINK_MEMO_SELECT },
};
const LINK_TERM_SELECT = { id: true, term: true };

export const COURSE_LINK_SELECT = {
  id: true,
  title: true,
  blocks: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      title: true,
      order: true,
      slides: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: LINK_SLIDE_SELECT },
      questions: { orderBy: [{ order: 'asc' }], select: LINK_QUESTION_SELECT },
      memoSlides: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: LINK_MEMO_SLIDE_SELECT },
      terms: { orderBy: [{ term: 'asc' }], select: LINK_TERM_SELECT },
    },
  },
};

/** Элементы блока: у каждого типа своё содержимое. */
function blockItems(block) {
  switch (block.type) {
    case 'theory':
      return (block.slides ?? []).map((slide, index) => ({ id: slide.id, index, title: slide.title ?? '' }));
    case 'test':
      return (block.questions ?? []).map((question, index) => ({
        id: question.id,
        index,
        title: questionTitle(question),
      }));
    case 'memo': {
      const items = [];

      for (const slide of block.memoSlides ?? []) {
        for (const cell of slide.cells ?? []) {
          items.push({ id: cell.id, index: items.length, title: cell.title ?? '', slideTitle: slide.title ?? '' });
        }
      }

      return items;
    }
    case 'glossary':
      return (block.terms ?? []).map((term, index) => ({ id: term.id, index, title: term.term ?? '' }));
    default:
      return [];
  }
}

/** Курс из БД в дерево для диалога ссылок. */
export function toLinkMap(course) {
  return {
    id: course.id,
    title: course.title,
    blocks: (course.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      items: blockItems(block),
    })),
  };
}
