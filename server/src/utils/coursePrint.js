import { QUESTION_SELECT } from './questions.js';

/**
 * Данные курса для печатной версии (Шаг 15).
 *
 * Это read-model: тот же порядок, что у CRUD-эндпоинтов (массивы вместо `order`),
 * без `_count`, а у блока — только содержимое его типа. Клиент рендерит документ
 * целиком, поэтому содержимое всех блоков приходит одним запросом — без N+1
 * на слайды, вопросы, памятку и глоссарий.
 */

/** Только то, что реально печатается: тип, ширина и данные фрагмента. */
const PRINT_CONTENT_SELECT = {
  id: true,
  type: true,
  data: true,
  dataVersion: true,
  width: true,
  order: true,
};

const PRINT_SLIDE_SELECT = {
  id: true,
  title: true,
  order: true,
  contents: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: PRINT_CONTENT_SELECT,
  },
};

const PRINT_MEMO_CELL_SELECT = {
  id: true,
  title: true,
  titleDoc: true,
  body: true,
  order: true,
};

const PRINT_MEMO_SLIDE_SELECT = {
  id: true,
  title: true,
  order: true,
  cells: {
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: PRINT_MEMO_CELL_SELECT,
  },
};

const PRINT_TERM_SELECT = {
  id: true,
  term: true,
  definition: true,
};

const PRINT_BLOCK_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  coverImage: true,
  order: true,
  slides: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: PRINT_SLIDE_SELECT },
  questions: { orderBy: [{ order: 'asc' }], select: QUESTION_SELECT },
  memoSlides: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: PRINT_MEMO_SLIDE_SELECT },
  terms: { orderBy: [{ term: 'asc' }], select: PRINT_TERM_SELECT },
};

export const COURSE_PRINT_SELECT = {
  id: true,
  title: true,
  description: true,
  updatedAt: true,
  blocks: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: PRINT_BLOCK_SELECT,
  },
};

/** Блок печати: оставляем только содержимое своего типа. */
function toPrintBlock(block) {
  const base = {
    id: block.id,
    type: block.type,
    title: block.title,
    description: block.description,
    coverImage: block.coverImage,
    order: block.order,
  };

  switch (block.type) {
    case 'theory':
      return {
        ...base,
        slides: (block.slides ?? []).map((slide) => ({
          id: slide.id,
          title: slide.title,
          order: slide.order,
          contents: slide.contents ?? [],
        })),
      };
    case 'test':
      return { ...base, questions: block.questions ?? [] };
    case 'memo':
      return {
        ...base,
        memoSlides: (block.memoSlides ?? []).map((slide) => ({
          id: slide.id,
          title: slide.title,
          order: slide.order,
          cells: slide.cells ?? [],
        })),
      };
    case 'glossary':
      return { ...base, terms: block.terms ?? [] };
    default:
      return base;
  }
}

/** Курс из БД в форму, которую рендерит страница печати. */
export function toPrintCourse(course) {
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    updatedAt: course.updatedAt,
    blocks: (course.blocks ?? []).map(toPrintBlock),
  };
}
