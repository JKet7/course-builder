import { QUESTION_LIMITS } from './helpers.js';

/**
 * Черновик вопроса для редактора: плоская структура вместо вложенного data.
 * Совпадает по смыслу с server/src/utils/questions.js.
 */

const QUESTION_TYPE_VALUES = ['single', 'multiple', 'match', 'card'];

const TARGET_TYPE_VALUES = ['next', 'section', 'submit'];

/** Цель перехода варианта: раздел сохраняется только вместе с его id. */
const optionTarget = (option) => {
  const targetType = TARGET_TYPE_VALUES.includes(option?.targetType) ? option.targetType : 'next';

  if (targetType === 'submit') return { targetType: 'submit', targetSectionId: null };
  if (targetType === 'section' && option?.targetSectionId) {
    return { targetType: 'section', targetSectionId: option.targetSectionId };
  }

  return { targetType: 'next', targetSectionId: null };
};

const emptyOptions = () => [
  { text: '', isCorrect: true, ...optionTarget() },
  { text: '', isCorrect: false, ...optionTarget() },
];

const emptyPairs = () => [
  { left: '', right: '' },
  { left: '', right: '' },
];

/** Вопрос с сервера → черновик редактора. */
export function toDraft(question) {
  const data = question?.data && typeof question.data === 'object' ? question.data : {};
  const type = QUESTION_TYPE_VALUES.includes(question?.type) ? question.type : 'single';

  const options = (question?.options ?? []).map((option) => ({
    text: option.text ?? '',
    isCorrect: Boolean(option.isCorrect),
    ...optionTarget(option),
  }));

  const pairs = (question?.pairs ?? []).map((pair) => ({
    left: pair.left ?? '',
    right: pair.right ?? '',
  }));

  return {
    type,
    text: data.text ?? '',
    front: data.front ?? '',
    back: data.back ?? '',
    frontImage: data.frontImage ?? '',
    backImage: data.backImage ?? '',
    options: options.length > 0 ? options : emptyOptions(),
    pairs: pairs.length > 0 ? pairs : emptyPairs(),
    explanation: question?.explanation ?? null,
    groupId: question?.groupId ?? null,
  };
}

/** Черновик → тело запроса POST/PUT /api/questions. */
export function toPayload(draft) {
  const isCard = draft.type === 'card';

  return {
    type: draft.type,
    data: isCard
      ? {
          front: draft.front,
          back: draft.back,
          frontImage: draft.frontImage ?? '',
          backImage: draft.backImage ?? '',
        }
      : { text: draft.text },
    options: draft.type === 'single' || draft.type === 'multiple' ? draft.options : [],
    pairs: draft.type === 'match' ? draft.pairs : [],
    // У карточки объяснения нет: обе стороны показываются сразу.
    explanation: isCard ? null : draft.explanation ?? null,
    groupId: draft.groupId || null,
  };
}

/** Проверка перед автосохранением: не отправляем заведомо неполный вопрос. */
export function validateDraft(draft) {
  if (draft.type === 'card') {
    const hasText = Boolean(draft.front.trim() || draft.back.trim());
    const hasImage = Boolean(String(draft.frontImage ?? '').trim() || String(draft.backImage ?? '').trim());

    if (!hasText && !hasImage) {
      return { ok: false, message: 'Заполните лицевую или обратную сторону карточки' };
    }
    return { ok: true };
  }

  if (!draft.text.trim()) {
    return { ok: false, message: 'Введите текст вопроса' };
  }

  if (draft.type === 'match') {
    const filled = draft.pairs.filter((pair) => pair.left.trim() || pair.right.trim());

    if (filled.length < 2) {
      return { ok: false, message: 'Нужно минимум две пары' };
    }

    if (filled.some((pair) => !pair.left.trim() || !pair.right.trim())) {
      return { ok: false, message: 'В каждой паре заполните обе стороны' };
    }

    return { ok: true };
  }

  const options = draft.options.filter((option) => option.text.trim());

  if (options.length < 2) {
    return { ok: false, message: 'Нужно минимум два варианта ответа' };
  }

  const correct = options.filter((option) => option.isCorrect).length;

  if (draft.type === 'single' && correct !== 1) {
    return { ok: false, message: 'Для «Одного ответа» отметьте ровно один верный вариант' };
  }

  if (draft.type === 'multiple' && correct < 1) {
    return { ok: false, message: 'Отметьте хотя бы один верный вариант' };
  }

  return { ok: true };
}

/** Короткое описание вопроса для свёрнутой карточки. */
export function summarizeDraft(draft) {
  if (draft.type === 'card') return draft.front.trim() || draft.back.trim() || 'Карточка без текста';
  if (draft.type === 'match') return draft.text.trim() || 'Сопоставление без текста';
  return draft.text.trim() || 'Вопрос без текста';
}

/** Пустой черновик для формы «Новый вопрос». */
export function createDraft(type = 'single', overrides = {}) {
  return {
    type: QUESTION_TYPE_VALUES.includes(type) ? type : 'single',
    text: '',
    front: '',
    back: '',
    frontImage: '',
    backImage: '',
    options: emptyOptions(),
    pairs: emptyPairs(),
    explanation: null,
    groupId: null,
    ...overrides,
  };
}

/**
 * Тело запроса для нового вопроса.
 * Варианты и пары заполняются заглушками: сервер не принимает вопрос без них,
 * дальше редактор карточки заменяет их настоящими.
 */
export function createQuestionPayload(type, text, groupId = null) {
  const value = String(text ?? '').trim();
  const base = { groupId: groupId || null, explanation: null };

  if (type === 'card') {
    return { ...base, type: 'card', data: { front: value, back: 'Ответ' }, options: [], pairs: [] };
  }

  if (type === 'match') {
    return {
      ...base,
      type: 'match',
      data: { text: value },
      options: [],
      pairs: [
        { left: 'Понятие 1', right: 'Значение 1' },
        { left: 'Понятие 2', right: 'Значение 2' },
      ],
    };
  }

  if (type === 'multiple') {
    return {
      ...base,
      type: 'multiple',
      data: { text: value },
      options: [
        { text: 'Верный вариант 1', isCorrect: true },
        { text: 'Верный вариант 2', isCorrect: true },
        { text: 'Неверный вариант', isCorrect: false },
      ],
      pairs: [],
    };
  }

  return {
    ...base,
    type: 'single',
    data: { text: value },
    options: [
      { text: 'Верный вариант', isCorrect: true },
      { text: 'Неверный вариант', isCorrect: false },
    ],
    pairs: [],
  };
}

export { QUESTION_LIMITS };
