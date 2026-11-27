import { docToText, getContentTypeLabel, normalizeContentData } from './helpers.js';
import { normalizeDialogData } from './dialog.js';

/**
 * Шаг 17: поиск по документу (блок «Теория»).
 *
 * Индекс не строится заранее: слайды блока уже лежат в `contentStore` вместе
 * с контентом, поэтому поиск — это проход по массиву. Текстовые поля зависят
 * от типа фрагмента (Tiptap-документ, ячейки таблицы, пункты чек-листа и т.д.),
 * поэтому у каждого типа свой способ достать строку.
 */

/** Минимальная длина запроса: один символ даёт слишком много совпадений. */
export const SEARCH_MIN_QUERY = 2;

/** Сколько результатов отдаём в панель; остальные считаются в `total`. */
export const SEARCH_LIMIT = 50;

/** Сколько символов контекста показывать слева и справа от совпадения. */
const SNIPPET_RADIUS = 60;

/** Текст для сравнения: нижний регистр, «ё» → «е» (1 символ в 1 символ). */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/** Запрос пользователя в том же виде, что и текст: без лишних пробелов. */
export function normalizeSearchQuery(value) {
  return normalizeSearchText(value).replace(/\s+/g, ' ').trim();
}

/**
 * Текстовые поля фрагмента: [{ label, text }].
 * Пустые поля отбрасываются, чтобы не плодить результаты без сниппета.
 */
export function getContentSearchFields(content) {
  const type = content?.type;
  const data = normalizeContentData(type, content?.data);
  const label = getContentTypeLabel(type);

  switch (type) {
    case 'text':
    case 'important':
      return [{ label, text: docToText(data) }];

    case 'table':
      return [
        {
          label,
          text: (data.cells ?? [])
            .map((row) => (Array.isArray(row) ? row.map((doc) => docToText(doc)).join(' ') : ''))
            .join(' '),
        },
      ];

    case 'image':
      return [{ label, text: [data.alt, data.caption].filter(Boolean).join(' ') }];

    case 'video':
      return [{ label, text: [data.caption, data.url].filter(Boolean).join(' ') }];

    case 'checklist':
      return [
        {
          label,
          text: [data.title, ...(data.items ?? []).map((item) => item?.text)].filter(Boolean).join(' '),
        },
      ];

    case 'code':
      return [{ label, text: [data.filename, data.code].filter(Boolean).join(' ') }];

    case 'replica': {
      // Диалог: строки реплик (старый формат — одна реплика, см. utils/dialog.js)
      const dialog = normalizeDialogData(data);

      return [
        {
          label,
          text: dialog.lines
            .map((line) => [line.character, line.text].filter(Boolean).join(' '))
            .filter(Boolean)
            .join(' '),
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Кусок текста вокруг совпадения: { before, match, after }.
 * Индексы берутся из нормализованной копии, поэтому регистр и «ё» не важны.
 */
export function makeSnippet(text, query, radius = SNIPPET_RADIUS) {
  const source = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!source) return null;

  const needle = normalizeSearchQuery(query);
  const at = needle ? normalizeSearchText(source).indexOf(needle) : -1;

  if (!needle || at === -1) {
    const head = source.length > radius * 2 ? `${source.slice(0, radius * 2)}…` : source;
    return { before: '', match: '', after: head };
  }

  const start = Math.max(0, at - radius);
  const end = Math.min(source.length, at + needle.length + radius);

  return {
    before: `${start > 0 ? '…' : ''}${source.slice(start, at)}`,
    match: source.slice(at, at + needle.length),
    after: `${source.slice(at + needle.length, end)}${end < source.length ? '…' : ''}`,
  };
}

/**
 * Поиск по всем слайдам блока.
 * Возвращает { results, total }: в `results` не больше `limit` записей,
 * `total` — сколько всего совпадений (слайд или фрагмент считаются один раз).
 *
 * Результат: { key, slideId, slideIndex, slideTitle, contentId, contentType,
 * contentLabel, snippet }.
 */
export function searchSlides(slides, query, { limit = SEARCH_LIMIT } = {}) {
  const needle = normalizeSearchQuery(query);
  if (needle.length < SEARCH_MIN_QUERY) return { results: [], total: 0 };

  const results = [];
  let total = 0;

  (slides ?? []).forEach((slide, index) => {
    if (!slide) return;

    const slideNumber = index + 1;
    const slideTitle = slide.title?.trim() || `Слайд ${slideNumber}`;

    const push = (entry) => {
      total += 1;
      if (results.length < limit) results.push({ key: `${slide.id}:${entry.contentId ?? 'title'}`, slideId: slide.id, slideIndex: index, slideTitle, ...entry });
    };

    // 1. Название слайда — отдельный результат: он открывает слайд целиком.
    if (normalizeSearchText(slideTitle).includes(needle)) {
      push({
        contentId: null,
        contentType: 'slide',
        contentLabel: 'Слайд',
        snippet: makeSnippet(slideTitle, needle),
      });
    }

    // 2. Фрагменты контента: одна строка на фрагмент (первое совпадение).
    const scanContents = (contents) => {
      for (const content of contents ?? []) {
        const fields = getContentSearchFields(content);
        const hit = fields.find((field) => normalizeSearchText(field.text).includes(needle));

        if (!hit) continue;

        push({
          contentId: content.id,
          contentType: content.type,
          contentLabel: getContentTypeLabel(content.type),
          snippet: makeSnippet(hit.text, needle),
        });
      }
    };

    if ((slide.cards ?? []).length > 0) {
      // Памятка: карточка — отдельный результат, затем её фрагменты.
      for (const [cardIndex, card] of slide.cards.entries()) {
        const cardTitle = card.title?.trim() || `Карточка ${cardIndex + 1}`;

        if (normalizeSearchText(cardTitle).includes(needle)) {
          push({
            contentId: card.id,
            contentType: 'memoCard',
            contentLabel: 'Карточка',
            snippet: makeSnippet(cardTitle, needle),
          });
        }

        scanContents(card.contents);
      }

      return;
    }

    scanContents(slide.contents);
  });

  return { results, total };
}
