/**
 * Чистые помощники режима редактора теста: раскладка разделов ветвления,
 * перетаскивание и логика перехода вариантов ответа.
 *
 * Без React — их проверяет scripts/render-check.mjs.
 */

/** Допустимые цели перехода (совпадает с server/src/utils/questions.js). */
export const TARGET_TYPES = ['next', 'section', 'submit'];

/**
 * Значение для выпадающего списка «Логика перехода»:
 * 'next' | 'submit' | 'section:<id>'.
 */
export function optionTargetValue(option) {
  if (option?.targetType === 'submit') return 'submit';
  if (option?.targetType === 'section' && option?.targetSectionId) return `section:${option.targetSectionId}`;
  return 'next';
}

/** Обратное преобразование значения списка в поля варианта. */
export function parseTargetValue(value) {
  if (value === 'submit') return { targetType: 'submit', targetSectionId: null };

  if (typeof value === 'string' && value.startsWith('section:')) {
    const sectionId = value.slice('section:'.length);
    if (sectionId) return { targetType: 'section', targetSectionId: sectionId };
  }

  return { targetType: 'next', targetSectionId: null };
}

/** Новый набор вариантов, где у указанного варианта сменена цель перехода. */
export function setOptionTarget(options, index, value) {
  const target = parseTargetValue(value);
  return (options ?? []).map((option, optionIndex) =>
    optionIndex === index ? { ...option, ...target } : option,
  );
}

/**
 * Варианты, у которых раздел удалён, становятся «следующий вопрос».
 * Иначе автосохранение упало бы с ошибкой «раздел не найден».
 */
export function sanitizeTargets(options, sections = []) {
  const known = new Set(sections.map((section) => section.id));

  return (options ?? []).map((option) => {
    if (option?.targetType === 'submit') {
      return { ...option, targetType: 'submit', targetSectionId: null };
    }

    if (option?.targetType === 'section' && option?.targetSectionId && known.has(option.targetSectionId)) {
      return { ...option, targetType: 'section', targetSectionId: option.targetSectionId };
    }

    return { ...option, targetType: 'next', targetSectionId: null };
  });
}

/**
 * Новый порядок после перетаскивания: dragId встаёт на место targetId.
 * null — перетаскивать нечего (нет id или позиция не изменилась).
 */
export function dragReorder(ids, dragId, targetId) {
  const list = Array.isArray(ids) ? ids : [];
  const from = list.indexOf(dragId);
  const to = list.indexOf(targetId);

  if (from === -1 || to === -1 || from === to) return null;

  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/**
 * Строки редактора: карточка раздела встаёт перед первым своим вопросом,
 * разделы без вопросов показываются в конце списка.
 * Возвращает [{ kind: 'section', section, key } | { kind: 'question', question, number, key }].
 */
export function buildEditorRows(questions, sections = []) {
  const sortedQuestions = [...(questions ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const sortedSections = [...(sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const anchor = new Map();
  sortedQuestions.forEach((question, index) => {
    if (question.sectionId && !anchor.has(question.sectionId)) anchor.set(question.sectionId, index);
  });

  const rows = [];

  sortedQuestions.forEach((question, index) => {
    for (const section of sortedSections) {
      if (anchor.get(section.id) === index) {
        rows.push({ kind: 'section', section, key: `section-${section.id}` });
      }
    }

    rows.push({ kind: 'question', question, number: index + 1, key: question.id });
  });

  for (const section of sortedSections) {
    if (!anchor.has(section.id)) rows.push({ kind: 'section', section, key: `section-${section.id}` });
  }

  return rows;
}

/** Сколько вопросов относится к разделу. */
export function countSectionQuestions(questions, sectionId) {
  return (questions ?? []).filter((question) => question.sectionId === sectionId).length;
}
