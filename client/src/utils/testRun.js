/**
 * Логика прохождения теста: последовательность вопросов, проверка ответов,
 * ветвление и результаты. Чистые функции без React — их проверяет render-check.
 *
 * Состояние попытки хранится в localStorage (`course-builder:test:<blockId>`):
 * прогресс, таймер и отметки «Вернуться позже» (`run.flags`) переживают
 * перезагрузку страницы, как чек-листы теории.
 */

export const TEST_RUN_VERSION = 1;

/** Ключ localStorage для попытки конкретного блока. */
export const testRunKey = (blockId) => `course-builder:test:${blockId}`;

/** Настройки теста по умолчанию (совпадает с сервером). */
export const DEFAULT_SETTINGS = {
  shuffleQuestions: false,
  shuffleOptions: false,
  branching: false,
  result: null,
};

/** Вердикт ответа в режиме ветвления: ответ дан, но оценки нет. */
export const ANSWERED_VERDICT = 'answered';

/**
 * Тест с оценкой. В режиме ветвления верных и неверных ответов нет: варианты
 * только выбирают путь читателя, поэтому проценты и статистика не считаются.
 */
export function isGraded(settings) {
  return !settings?.branching;
}

/** Секунды → «ММ:СС» (для длинных тестов — «ЧЧ:ММ:СС»). */
export function formatDuration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (number) => String(number).padStart(2, '0');

  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Перемешивание копии массива (Fisher–Yates). */
export function shuffle(list, random = Math.random) {
  const result = [...list];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }

  return result;
}

/** Порядок вопросов читателя: разделы идут блоками, внутри — свой order. */
export function orderedQuestions(questions, sections = []) {
  const sorted = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const sectionOrder = new Map(
    [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((section, index) => [section.id, index]),
  );

  const weight = (question) => (question.sectionId && sectionOrder.has(question.sectionId)
    ? sectionOrder.get(question.sectionId) + 1
    : 0);

  return sorted.sort((a, b) => {
    const diff = weight(a) - weight(b);
    return diff !== 0 ? diff : (a.order ?? 0) - (b.order ?? 0);
  });
}

/** Последовательность id вопросов для новой попытки. */
export function buildSequence(questions, { shuffleQuestions = false, random = Math.random } = {}) {
  const list = questions.map((question) => question.id);
  return shuffleQuestions ? shuffle(list, random) : list;
}

/** Порядок вариантов конкретного вопроса (перемешивание сохраняется в попытке). */
export function optionSequence(question, { shuffleOptions = false, random = Math.random } = {}) {
  const ids = (question.options ?? []).map((option) => option.id);
  return shuffleOptions ? shuffle(ids, random) : ids;
}

/** Верный ответ на вопрос: множество id верных вариантов / пары. */
export function correctOptionIds(question) {
  return (question.options ?? []).filter((option) => option.isCorrect).map((option) => option.id);
}

/**
 * Проверка ответа (первая попытка фиксируется отдельно — в `answers[qid].first`).
 * answer: { selected: [optionId], matches: { leftId: rightId }, verdict: 'know' | 'dont-know' }
 */
export function isAnswerCorrect(question, answer) {
  if (!answer) return false;

  if (question.type === 'single') {
    const correct = correctOptionIds(question);
    return (answer.selected ?? []).length === 1 && correct.length === 1 && answer.selected[0] === correct[0];
  }

  if (question.type === 'multiple') {
    const correct = new Set(correctOptionIds(question));
    const selected = new Set(answer.selected ?? []);
    if (correct.size === 0 || selected.size !== correct.size) return false;

    for (const id of selected) if (!correct.has(id)) return false;
    return true;
  }

  if (question.type === 'match') {
    const pairs = question.pairs ?? [];
    if (pairs.length === 0) return false;
    return pairs.every((pair) => answer.matches?.[pair.id] === pair.id);
  }

  // Карточка: «Знаю» считаем верным ответом, «Не знаю» — нет.
  return answer.know === true || answer.verdict === 'know' || answer.verdict === 'correct';
}

/** Ответ уже зафиксирован: оценка (или сам факт ответа при ветвлении) записана. */
export function isResolved(answer) {
  const verdict = answer?.verdict;
  return verdict === 'correct' || verdict === 'wrong' || verdict === ANSWERED_VERDICT;
}

/** Вопрос отмечен флажком «Вернуться позже» (карта `run.flags`). */
export function isFlagged(run, questionId) {
  return Boolean(questionId && run?.flags?.[questionId]);
}

/** Сколько вопросов отмечено флажком — подпись панели навигации. */
export function flaggedCount(run) {
  return Object.keys(run?.flags ?? {}).length;
}

/**
 * Флажок «Вернуться позже»: отметка живёт в попытке, поэтому не зависит от
 * того, отвечен вопрос или нет, и не мешает переходить к нему из навигации.
 * Повторный вызов снимает отметку — ключ из карты удаляется.
 */
export function toggleFlag(run, questionId) {
  if (!run || !questionId) return run;

  const flags = { ...(run.flags ?? {}) };

  if (flags[questionId]) delete flags[questionId];
  else flags[questionId] = true;

  return { ...run, flags };
}

/**
 * Ответ готов к отправке кнопкой «Готово»: отмечен хотя бы один вариант,
 * соединены все пары или нажата сторона карточки. Пока это не так, кнопка
 * «Готово» неактивна.
 */
export function canSubmit(question, value = {}) {
  if (!question) return false;
  if (question.type === 'match') return matchProgress(question, value.matches).complete;
  if (question.type === 'card') return value.know === true || value.know === false;
  return (value.selected ?? []).length > 0;
}

/**
 * Проверка ответа по кнопке «Готово» — единственное место, где появляется
 * вердикт. До нажатия выбор остаётся черновиком попытки (`run.picks`): его
 * можно менять сколько угодно, и подсветки «верно / неверно» не показывается.
 */
export function gradeAnswer(question, value = {}, graded = true) {
  if (!graded) return { ...value, verdict: ANSWERED_VERDICT };
  return { ...value, verdict: isAnswerCorrect(question, value) ? 'correct' : 'wrong' };
}

/** Счётчик сопоставления: сколько пар соединено и все ли. */
export function matchProgress(question, matches = {}) {
  const pairs = question?.pairs ?? [];
  const matched = pairs.filter((pair) => matches?.[pair.id] !== undefined).length;
  return { matched, total: pairs.length, complete: pairs.length > 0 && matched === pairs.length };
}

/** Прогресс прохождения: отвеченные вопросы последовательности. */
export function runProgress(run) {
  const sequence = Array.isArray(run?.sequence) ? run.sequence : [];
  const answers = run?.answers ?? {};
  const answered = sequence.filter((id) => isResolved(answers[id])).length;

  return {
    total: sequence.length,
    answered,
    percent: sequence.length > 0 ? Math.round((answered / sequence.length) * 100) : 0,
  };
}

/**
 * Куда ведёт ответ (ветвление). В обычном режиме — всегда следующий вопрос.
 * Если выбрано несколько целей, «Отправить форму» важнее раздела.
 */
export function resolveTarget(question, answer, settings) {
  if (!settings?.branching) return { type: 'next' };

  const selected = new Set(answer?.selected ?? []);
  const candidates = (question.options ?? []).filter(
    (option) => selected.has(option.id) && (option.targetType === 'submit' || option.targetType === 'section'),
  );

  if (candidates.length === 0) return { type: 'next' };
  if (candidates.some((option) => option.targetType === 'submit')) return { type: 'submit' };

  const section = candidates.find((option) => option.targetSectionId);
  return section ? { type: 'section', sectionId: section.targetSectionId } : { type: 'next' };
}

/**
 * Следующий вопрос после ответа: обычный порядок, первый вопрос раздела или
 * null — тест закончен («Отправить форму» либо вопросы кончились).
 */
export function nextQuestionId({ sequence, currentId, questions, answer, settings }) {
  const index = sequence.indexOf(currentId);
  if (index === -1) return null;

  const question = questions.find((item) => item.id === currentId);
  if (!question) return null;

  const target = resolveTarget(question, answer, settings);

  if (target.type === 'submit') return null;

  if (target.type === 'section') {
    const byId = new Map(questions.map((item) => [item.id, item]));
    return sequence.find((id) => byId.get(id)?.sectionId === target.sectionId) ?? null;
  }

  return sequence[index + 1] ?? null;
}

/** Итоговый комментарий: итог раздела, на котором закончился путь, иначе итог теста. */
export function finalResult({ sequence, questions, answers, sections = [], settings }) {
  if (!settings?.branching) return settings?.result ?? null;

  const byId = new Map(questions.map((question) => [question.id, question]));
  const lastAnswered = [...sequence].reverse().find((id) => isResolved(answers?.[id]));

  if (lastAnswered) {
    const sectionId = byId.get(lastAnswered)?.sectionId;
    const section = sections.find((item) => item.id === sectionId);
    if (section?.result) return section.result;
  }

  return settings?.result ?? null;
}

/** Заголовок вопроса для читателя и экрана результатов. */
export function questionTitle(question) {
  const data = question?.data ?? {};
  if (question?.type === 'card') return data.front || 'Карточка';
  if (question?.type === 'match') return data.text || 'Сопоставьте пары';
  return data.text || 'Вопрос без текста';
}

/** Текст ответа читателя для экрана результатов. */
export function answerLabel(question, answer) {
  if (!answer) return 'Нет ответа';

  if (question.type === 'card') {
    if (answer.know === true || answer.verdict === 'know' || answer.verdict === 'correct') return 'Знаю';
    if (answer.know === false || answer.verdict === 'dont-know' || answer.verdict === 'wrong') return 'Не знаю';
    return 'Нет ответа';
  }

  if (question.type === 'match') {
    const pairs = question.pairs ?? [];
    const matched = pairs.filter((pair) => answer.matches?.[pair.id] === pair.id).length;
    return `Соединено ${matched} из ${pairs.length}`;
  }

  const selected = new Set(answer.selected ?? []);
  const texts = (question.options ?? []).filter((option) => selected.has(option.id)).map((option) => option.text);
  return texts.length > 0 ? texts.join('; ') : 'Нет ответа';
}

/** Текст правильного ответа для экрана результатов. */
export function correctLabel(question) {
  if (question.type === 'card') return question.data?.back || question.data?.front || '—';

  if (question.type === 'match') {
    return (question.pairs ?? []).map((pair) => `${pair.left} ↔ ${pair.right}`).join('; ');
  }

  const texts = (question.options ?? []).filter((option) => option.isCorrect).map((option) => option.text);
  return texts.length > 0 ? texts.join('; ') : '—';
}

/**
 * Итоги попытки: процент (когда тест с оценкой), время, статистика по группам
 * и детализация. В режиме ветвления оценки нет — считаются только отвеченные
 * вопросы, а правильные ответы не показываются.
 * Процент считается по отвеченным вопросам: при ветвлении путь у всех разный.
 */
export function computeResults({ questions, run, sections = [], settings }) {
  const graded = isGraded(settings);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const sequence = (run?.sequence ?? []).filter((id) => byId.has(id));
  const answers = run?.answers ?? {};

  let correct = 0;
  let answered = 0;

  const groups = new Map();
  const details = [];

  for (const id of sequence) {
    const question = byId.get(id);
    const answer = answers[id];
    const groupKey = question.groupId ?? 'none';
    const groupName = question.group?.name ?? 'Без группы';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { id: groupKey, name: groupName, total: 0, answered: 0, correct: 0 });
    }

    const group = groups.get(groupKey);
    group.total += 1;

    // Ответ без зафиксированного вердикта (черновик выбора) вопрос не закрывает:
    // процент и прогресс считаются только по закрытым ответам.
    const resolved = isResolved(answer);

    if (resolved) {
      answered += 1;
      group.answered += 1;

      if (graded && answer.verdict === 'correct') {
        correct += 1;
        group.correct += 1;
      }
    }

    details.push({
      id,
      question,
      answered: resolved,
      verdict: resolved ? (graded ? answer.verdict : ANSWERED_VERDICT) : null,
      answer: resolved ? answerLabel(question, answer) : '',
      correct: graded ? correctLabel(question) : null,
    });
  }

  const list = [...groups.values()].map((group) => ({
    ...group,
    correct: graded ? group.correct : null,
    percent: graded && group.answered > 0 ? Math.round((group.correct / group.answered) * 100) : null,
  }));

  return {
    graded,
    total: sequence.length,
    answered,
    correct: graded ? correct : null,
    wrong: graded ? answered - correct : null,
    percent: graded && answered > 0 ? Math.round((correct / answered) * 100) : null,
    elapsed: elapsedSeconds(run),
    groups: list,
    details,
    result: finalResult({ sequence, questions, answers, sections, settings }),
  };
}

/** Сколько секунд идёт тест: накопленное время + текущий отрезок. */
export function elapsedSeconds(run, now = Date.now()) {
  if (!run) return 0;
  const running = run.running && run.runningSince && !run.finished ? (now - run.runningSince) / 1000 : 0;
  return Math.max(0, Math.round((run.elapsed ?? 0) + running));
}

/**
 * Сверка сохранённой попытки с текущим тестом.
 * Вопросы могли добавить или удалить, варианты — отредактировать. Порядок
 * существующих вопросов и перемешанных вариантов сохраняем, новые дописываем
 * в конец, удалённые вычищаем вместе с ответами. Черновики, метки «Вернуться
 * позже» и ответы на исчезнувшие вопросы читателю уже не нужны.
 */
export function reconcileRun(run, questions, settings = DEFAULT_SETTINGS) {
  if (!run) return run;

  const ids = questions.map((question) => question.id);
  const known = new Set(ids);
  const previous = Array.isArray(run.sequence) ? run.sequence : [];
  const sequence = previous.filter((id) => known.has(id));

  for (const id of ids) if (!sequence.includes(id)) sequence.push(id);

  const currentId = sequence.includes(run.currentId) ? run.currentId : sequence[0] ?? null;

  const keepKnown = (source) =>
    Object.fromEntries(Object.entries(source ?? {}).filter(([id]) => known.has(id)));

  const optionOrder = keepKnown(run.optionOrder);
  const pairOrder = keepKnown(run.pairOrder);

  for (const question of questions) {
    if (question.type === 'match') {
      const pairIds = (question.pairs ?? []).map((pair) => pair.id);
      const valid = new Set(pairIds);
      const stored = (pairOrder[question.id] ?? []).filter((id) => valid.has(id));
      for (const id of pairIds) if (!stored.includes(id)) stored.push(id);
      pairOrder[question.id] = stored;
    }

    if (!settings.shuffleOptions) continue;

    const optionIds = (question.options ?? []).map((option) => option.id);
    if (optionIds.length === 0) continue;

    const valid = new Set(optionIds);
    const stored = (optionOrder[question.id] ?? []).filter((id) => valid.has(id));

    if (stored.length === 0) {
      optionOrder[question.id] = optionSequence(question, { shuffleOptions: true });
    } else {
      for (const id of optionIds) if (!stored.includes(id)) stored.push(id);
      optionOrder[question.id] = stored;
    }
  }

  const answers = keepKnown(run.answers);
  const picks = keepKnown(run.picks);
  const flags = keepKnown(run.flags);

  return { ...run, sequence, currentId, optionOrder, pairOrder, answers, picks, flags };
}

/** Новая попытка: порядок вопросов и вариантов фиксируется сразу. */
export function createRun(blockId, questions, settings = DEFAULT_SETTINGS, random = Math.random) {
  const sequence = buildSequence(questions, { shuffleQuestions: Boolean(settings.shuffleQuestions), random });
  const optionOrder = {};
  const pairOrder = {};

  if (settings.shuffleOptions) {
    for (const question of questions) {
      optionOrder[question.id] = optionSequence(question, { shuffleOptions: true, random });
    }
  }

  // Правая колонка сопоставления всегда перемешана: иначе верная пара стоит
  // напротив своего понятия и задание теряет смысл. Порядок хранится в попытке,
  // поэтому после перезагрузки колонка не прыгает.
  for (const question of questions) {
    if (question.type !== 'match') continue;
    pairOrder[question.id] = shuffle((question.pairs ?? []).map((pair) => pair.id), random);
  }

  return {
    version: TEST_RUN_VERSION,
    blockId,
    sequence,
    optionOrder,
    pairOrder,
    currentId: sequence[0] ?? null,
    answers: {},
    picks: {},
    flags: {},
    links: {},
    startedAt: Date.now(),
    elapsed: 0,
    running: true,
    runningSince: Date.now(),
    finished: false,
    finishedAt: null,
  };
}

/** Пауза таймера: текущий отрезок переносится в накопленное время. */
export function pauseRun(run, now = Date.now()) {
  if (!run) return run;
  return { ...run, elapsed: elapsedSeconds(run, now), running: false, runningSince: null };
}

/** Возобновление таймера после загрузки страницы или возврата из редактора. */
export function resumeRun(run, now = Date.now()) {
  if (!run || run.finished) return run;
  return { ...run, elapsed: elapsedSeconds(run, now), running: true, runningSince: now };
}

/** Завершение попытки: таймер останавливается, экран результатов открыт. */
export function finishRun(run, now = Date.now()) {
  if (!run) return run;
  return { ...pauseRun(run, now), finished: true, finishedAt: now };
}

/**
 * Чтение попытки из localStorage (битые данные игнорируются).
 * Сохранённая попытка считается приостановленной: время, пока страница была
 * закрыта, в таймер не попадает. Читатель возобновляет его при монтировании.
 */
export function readRun(blockId) {
  try {
    const raw = globalThis.localStorage?.getItem(testRunKey(blockId));
    if (!raw) return null;

    const run = JSON.parse(raw);
    if (!run || run.version !== TEST_RUN_VERSION || !Array.isArray(run.sequence)) return null;

    return {
      ...run,
      elapsed: Math.max(0, Number(run.elapsed) || 0),
      running: false,
      runningSince: null,
    };
  } catch {
    return null;
  }
}

/**
 * Запись попытки. Пока таймер идёт, в хранилище кладём снимок с уже
 * посчитанным временем и свежим runningSince — иначе после перезагрузки
 * к времени добавился бы весь перерыв.
 */
export function writeRun(blockId, run) {
  try {
    const now = Date.now();
    const snapshot =
      run && run.running && run.runningSince
        ? { ...run, elapsed: elapsedSeconds(run, now), runningSince: now }
        : run;

    globalThis.localStorage?.setItem(testRunKey(blockId), JSON.stringify(snapshot));
  } catch {
    // Переполнение хранилища не должно ломать тест.
  }
}

export function clearRun(blockId) {
  try {
    globalThis.localStorage?.removeItem(testRunKey(blockId));
  } catch {
    // ignore
  }
}

