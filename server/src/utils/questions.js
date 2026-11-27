import { normalizeDoc } from './tiptap.js';

/** Типы вопросов теста (совпадает с client/src/utils/helpers.js). */
export const QUESTION_TYPES = ['single', 'multiple', 'match', 'card'];

/** Подписи для сообщений об ошибках. */
export const QUESTION_TYPE_LABELS = {
  single: 'Один ответ',
  multiple: 'Несколько ответов',
  match: 'Сопоставление',
  card: 'Карточка',
};

/** Ограничения размеров вопроса. */
export const QUESTION_LIMITS = { options: 12, pairs: 12, text: 2000, cardSide: 4000, sections: 100, sectionTitle: 200 };

/** Допустимые цели перехода у варианта ответа (режим ветвления). */
export const TARGET_TYPES = ['next', 'section', 'submit'];

/** Поля TestOption, которые отдаём клиенту. */
const OPTION_SELECT = {
  id: true,
  text: true,
  isCorrect: true,
  order: true,
  targetType: true,
  targetSectionId: true,
};

/** Поля TestSection, которые отдаём клиенту. */
export const SECTION_SELECT = {
  id: true,
  blockId: true,
  title: true,
  result: true,
  order: true,
  _count: { select: { questions: true } },
};

/** Настройки теста по умолчанию (строка TestSettings может ещё не существовать). */
export const DEFAULT_TEST_SETTINGS = {
  shuffleQuestions: false,
  shuffleOptions: false,
  branching: false,
  result: null,
};

/** Поля TestQuestion, которые отдаём клиенту. */
export const QUESTION_SELECT = {
  id: true,
  blockId: true,
  groupId: true,
  sectionId: true,
  type: true,
  data: true,
  explanation: true,
  order: true,
  group: { select: { id: true, name: true } },
  section: { select: { id: true, title: true } },
  options: {
    select: OPTION_SELECT,
    orderBy: { order: 'asc' },
  },
  pairs: {
    select: { id: true, left: true, right: true, order: true },
    orderBy: { order: 'asc' },
  },
};

const trimText = (value) => String(value ?? '').trim();

/** Варианты ответа: от 2 до 12 непустых, у single ровно один верный. */
export function normalizeOptions(raw, type) {
  const list = Array.isArray(raw) ? raw.slice(0, QUESTION_LIMITS.options) : [];

  const options = list
    .map((item) => {
      const targetType = TARGET_TYPES.includes(item?.targetType) ? item.targetType : 'next';
      const option = { text: trimText(item?.text), isCorrect: Boolean(item?.isCorrect), targetType };

      if (targetType === 'section') {
        const sectionId = trimText(item?.targetSectionId);
        if (sectionId) option.targetSectionId = sectionId;
        // Индекс раздела — только для архива курса (см. utils/courseArchive.js).
        if (Number.isInteger(item?.targetSectionIndex)) {
          option.targetSectionIndex = item.targetSectionIndex;
        }
      }

      return option;
    })
    .filter((item) => item.text !== '');

  if (options.length < 2) {
    return { ok: false, message: 'Нужно минимум два непустых варианта ответа' };
  }

  const correct = options.filter((option) => option.isCorrect).length;

  if (type === 'single' && correct !== 1) {
    return { ok: false, message: 'Для типа «Один ответ» отметьте ровно один верный вариант' };
  }

  if (type === 'multiple' && correct < 1) {
    return { ok: false, message: 'Для типа «Несколько ответов» отметьте хотя бы один верный вариант' };
  }

  return { ok: true, options };
}

/** Пары для сопоставления: от 2 до 12, обе стороны заполнены. */
export function normalizePairs(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, QUESTION_LIMITS.pairs) : [];
  const pairs = [];

  for (const item of list) {
    const left = trimText(item?.left);
    const right = trimText(item?.right);

    if (!left && !right) continue;
    if (!left || !right) {
      return { ok: false, message: 'В каждой паре должны быть заполнены обе стороны' };
    }

    pairs.push({ left, right });
  }

  if (pairs.length < 2) {
    return { ok: false, message: 'Нужно минимум две пары для сопоставления' };
  }

  return { ok: true, pairs };
}

/**
 * Проверка и нормализация вопроса.
 * payload: { data: { text } | { front, back }, options?, pairs?, explanation? }
 * Возвращает { ok: true, type, data, options, pairs, explanation } | { ok: false, message }.
 */
export function normalizeQuestion(type, payload = {}) {
  if (!QUESTION_TYPES.includes(type)) {
    return { ok: false, message: `Тип вопроса: допустимые значения — ${QUESTION_TYPES.join(', ')}` };
  }

  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};

  let explanation = null;
  if (payload.explanation !== undefined && payload.explanation !== null) {
    const result = normalizeDoc(payload.explanation);
    if (!result.ok) return { ok: false, message: `Пояснение: ${result.message}` };
    explanation = result.doc;
  }

  if (type === 'card') {
    const front = trimText(data.front).slice(0, QUESTION_LIMITS.cardSide);
    const back = trimText(data.back).slice(0, QUESTION_LIMITS.cardSide);
    const frontImage = trimText(data.frontImage).slice(0, 500);
    const backImage = trimText(data.backImage).slice(0, 500);

    if (!front && !back && !frontImage && !backImage) {
      return { ok: false, message: 'Заполните лицевую или обратную сторону карточки' };
    }

    const side = { front, back };
    if (frontImage) side.frontImage = frontImage;
    if (backImage) side.backImage = backImage;

    return { ok: true, type, data: side, options: [], pairs: [], explanation };
  }

  const text = trimText(data.text).slice(0, QUESTION_LIMITS.text);

  if (!text) {
    return { ok: false, message: 'Введите текст вопроса' };
  }

  if (type === 'match') {
    const pairs = normalizePairs(payload.pairs);
    if (!pairs.ok) return pairs;
    return { ok: true, type, data: { text }, options: [], pairs: pairs.pairs, explanation };
  }

  const options = normalizeOptions(payload.options, type);
  if (!options.ok) return options;

  return { ok: true, type, data: { text }, options: options.options, pairs: [], explanation };
}

/**
 * Проверка логики перехода у вариантов ответа.
 * `knownSectionIds` — разделы этого блока; переход в чужой раздел — ошибка.
 * Возвращает { ok: true, options } | { ok: false, message }.
 */
export function resolveOptionTargets(options, knownSectionIds) {
  const resolved = [];

  for (const option of options) {
    if (option.targetType !== 'section') {
      resolved.push({ text: option.text, isCorrect: option.isCorrect, targetType: 'next', targetSectionId: null });
      continue;
    }

    if (!option.targetSectionId || !knownSectionIds.has(option.targetSectionId)) {
      return { ok: false, message: 'Логика перехода: выбранный раздел не найден в этом блоке' };
    }

    resolved.push({
      text: option.text,
      isCorrect: option.isCorrect,
      targetType: 'section',
      targetSectionId: option.targetSectionId,
    });
  }

  return { ok: true, options: resolved };
}
