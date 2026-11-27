import { docToText, textToDoc } from './helpers.js';

/**
 * Разбор CSV для импорта теста и глоссария.
 *
 * Тест понимает три шаблона, которые редактор предлагает скачать:
 *  - вопросы:  `Вопрос; Вариант 1 … Вариант 12; Правильный ответ; Объяснение; Группа`
 *  - карточки: `Передняя сторона; Задняя сторона; Группа`
 *  - соответствие: `; Лево; Право; Группа` (одна пара на строку)
 * Плюс «умный» режим без заголовка (вопрос; варианты; номера верных; пояснение)
 * и явные маркеры типа в первой колонке.
 */

const DELIMITERS = [';', '\t', ','];

/** Разделитель по первой непустой строке: побеждает самый частый. */
export function detectDelimiter(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .find((row) => row.trim() !== '') ?? '';

  let best = ';';
  let bestCount = 0;

  for (const delimiter of DELIMITERS) {
    const count = line.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

/** CSV → строки ячеек. Понимает кавычки, `""` внутри кавычек и переводы строк. */
export function parseCsv(input, { delimiter } = {}) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const sep = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === sep) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char === '\r') continue;

    cell += char;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, delimiter: sep };
}

/**
 * Байты файла → текст. Сначала UTF-8 (с BOM или без), иначе windows-1251:
 * так сохраняет CSV старый Excel, и без этого русский текст превращается в «кракозябры».
 */
export function decodeCsvBytes(buffer) {
  const bytes = new Uint8Array(buffer ?? []);
  if (bytes.length === 0) return '';

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

const TERM_HEADER = /^(термин|термины|слово|term|terms)$/i;

/** Маркеры типа в колонке «Тип» (и в первой колонке без заголовка). */
const TYPE_MARKERS = new Map([
  ['карточка', 'card'],
  ['карточки', 'card'],
  ['card', 'card'],
  ['cards', 'card'],
  ['соответствие', 'match'],
  ['соответствия', 'match'],
  ['match', 'match'],
  ['matching', 'match'],
  ['один ответ', 'single'],
  ['одиночный', 'single'],
  ['single', 'single'],
  ['несколько ответов', 'multiple'],
  ['множественный', 'multiple'],
  ['multiple', 'multiple'],
]);

/** { type } по маркеру или null. */
function typeMarker(cell) {
  const type = TYPE_MARKERS.get(String(cell ?? '').trim().toLowerCase());
  return type ? { type } : null;
}

/** Разделитель пары: «кошка = cat», «кошка ↔ cat», «кошка -> cat». */
const PAIR_MARK = /\s*(?:↔|<=>|=>|->|—>|=)\s*/;

/** «лево = право» → { left, right }; null, если это не пара. */
function parsePairCell(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;

  const parts = text.split(PAIR_MARK);
  if (parts.length !== 2) return null;

  const left = parts[0].trim();
  const right = parts[1].trim();
  return left && right ? { left, right } : null;
}

/** Заголовок: нижний регистр, без BOM и лишних пробелов. */
const normalizeHeader = (cell) =>
  String(cell ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Названия колонок шаблонов → роли. */
const HEADER_ROLES = new Map([
  ['передняя сторона', 'front'],
  ['лицевая сторона', 'front'],
  ['лицо', 'front'],
  ['перед', 'front'],
  ['front', 'front'],
  ['front side', 'front'],
  ['задняя сторона', 'back'],
  ['обратная сторона', 'back'],
  ['оборот', 'back'],
  ['зад', 'back'],
  ['back', 'back'],
  ['back side', 'back'],
  ['лево', 'left'],
  ['левая сторона', 'left'],
  ['слева', 'left'],
  ['left', 'left'],
  ['право', 'right'],
  ['правая сторона', 'right'],
  ['справа', 'right'],
  ['right', 'right'],
  ['вопрос', 'text'],
  ['вопросы', 'text'],
  ['question', 'text'],
  ['questions', 'text'],
  ['правильный ответ', 'correct'],
  ['правильные ответы', 'correct'],
  ['верный ответ', 'correct'],
  ['верные ответы', 'correct'],
  ['номер', 'correct'],
  ['номера', 'correct'],
  ['номер ответа', 'correct'],
  ['номера ответов', 'correct'],
  ['номер верного', 'correct'],
  ['номера верных', 'correct'],
  ['номер верного ответа', 'correct'],
  ['номера верных ответов', 'correct'],
  ['ответ', 'correct'],
  ['ответы', 'correct'],
  ['correct', 'correct'],
  ['correct answer', 'correct'],
  ['answer', 'correct'],
  ['answers', 'correct'],
  ['объяснение', 'explanation'],
  ['пояснение', 'explanation'],
  ['комментарий', 'explanation'],
  ['explanation', 'explanation'],
  ['группа', 'group'],
  ['раздел', 'group'],
  ['категория', 'group'],
  ['group', 'group'],
  ['category', 'group'],
  ['тип', 'type'],
  ['type', 'type'],
]);

const OPTION_HEADER = /^(?:вариант|option)\s*(\d+)$/;

/** Заголовок шаблона → карта колонок; null — заголовка в первой строке нет. */
export function readCsvHeader(row) {
  const map = { options: [] };
  let recognized = false;

  (row ?? []).forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;

    const optionMatch = OPTION_HEADER.exec(key);
    if (optionMatch) {
      map.options.push({ index, order: Number(optionMatch[1]) });
      recognized = true;
      return;
    }

    const role = HEADER_ROLES.get(key);
    if (role && map[role] === undefined) {
      map[role] = index;
      recognized = true;
    }
  });

  if (!recognized) return null;

  map.options.sort((a, b) => a.order - b.order);

  const hasPairs = map.left !== undefined && map.right !== undefined;
  const hasCards = map.front !== undefined && map.back !== undefined;
  const hasQuiz = map.text !== undefined || map.correct !== undefined || map.options.length > 0;

  return hasPairs || hasCards || hasQuiz ? map : null;
}

const QUESTION_HEADER = /^(вопрос|вопросы|question|questions)$/i;

/** Ячейка по индексу колонки (пустая, если колонки нет). */
const cellAt = (cells, index) => (index === undefined ? '' : String(cells[index] ?? '').trim());

const CORRECT_SPLIT = /[|,;]+/;

/**
 * «Правильный ответ» → номера вариантов.
 * Понимает и текст варианта (`A`, `A|E`), и номер колонки (`1`, `1,2`).
 * optionList: [{ text, order }] в порядке колонок «Вариант N».
 */
function resolveCorrect(optionList, value) {
  const tokens = String(value ?? '')
    .split(CORRECT_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);

  const indexes = new Set();
  const unknown = [];

  for (const token of tokens) {
    const byText = optionList.findIndex((option) => option.text.toLowerCase() === token.toLowerCase());

    if (byText >= 0) {
      indexes.add(byText);
      continue;
    }

    if (/^\d+$/.test(token)) {
      const number = Number(token);
      const byOrder = optionList.findIndex((option) => option.order === number);

      if (byOrder >= 0) {
        indexes.add(byOrder);
        continue;
      }

      if (number >= 1 && number <= optionList.length) {
        indexes.add(number - 1);
        continue;
      }
    }

    unknown.push(token);
  }

  return { indexes, unknown };
}

/** Пары в строке: минимум две, непарной может быть только пояснение в конце. */
function looksLikeMatch(list) {
  const pairs = list.map(parsePairCell);
  if (pairs.filter(Boolean).length < 2) return false;

  const nonPair = pairs.map((pair, index) => (pair ? -1 : index)).filter((index) => index !== -1);
  return nonPair.length === 0 || (nonPair.length === 1 && nonPair[0] === list.length - 1);
}

/**
 * Старый формат без заголовка:
 * `вопрос; вариант 1; вариант 2; …; номера верных; пояснение`,
 * плюс маркеры «карточка» и «соответствие» в первой колонке.
 */
function parseLegacyQuestions(rows, items, errors) {
  rows.forEach((raw, index) => {
    const line = index + 1;
    const cells = raw.map((cell) => String(cell ?? '').trim());

    // Excel часто оставляет пустые хвостовые колонки — они не должны ломать разбор.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();

    if (cells.every((cell) => cell === '')) return;
    if (index === 0 && (QUESTION_HEADER.test(cells[0]) || TERM_HEADER.test(cells[0]))) return;

    const marker = typeMarker(cells[0]);
    const type = marker?.type ?? null;
    const rest = marker ? cells.slice(1) : cells;

    if (type === 'card' || (!type && rest.length === 2)) {
      const front = rest[0] ?? '';
      const back = rest[1] ?? '';

      if (!front && !back) {
        errors.push(`Строка ${line}: пустая карточка`);
        return;
      }

      items.push({ type: 'card', data: { front, back }, options: [], pairs: [], explanation: null, group: null, line });
      return;
    }

    if (type === 'match' || (!type && rest.length >= 3 && looksLikeMatch(rest.slice(1)))) {
      const text = rest[0] ?? '';

      if (!text) {
        errors.push(`Строка ${line}: пустой текст вопроса`);
        return;
      }

      const tail = rest.slice(1);
      const last = tail[tail.length - 1] ?? '';
      const withExplanation = last !== '' && !parsePairCell(last);
      const pairCells = withExplanation ? tail.slice(0, -1) : tail;
      const explanation = withExplanation ? last : '';
      const pairs = [];

      for (const cell of pairCells) {
        if (!cell) continue;
        const pair = parsePairCell(cell);

        if (!pair) {
          errors.push(`Строка ${line}: пара «${cell}» должна иметь вид «лево = право»`);
          return;
        }

        pairs.push(pair);
      }

      if (pairs.length < 2) {
        errors.push(`Строка ${line}: нужно минимум две пары`);
        return;
      }

      items.push({
        type: 'match',
        data: { text },
        options: [],
        pairs,
        explanation: explanation ? textToDoc(explanation) : null,
        group: null,
        line,
      });
      return;
    }

    const [text, ...cellsRest] = rest;

    if (!text) {
      errors.push(`Строка ${line}: пустой текст вопроса`);
      return;
    }

    if (cellsRest.length < 3) {
      errors.push(`Строка ${line}: нужны два варианта и номера верных`);
      return;
    }

    const last = cellsRest[cellsRest.length - 1];
    const hasExplanation = last !== '' && !/^[\d\s,|]+$/.test(last);
    const correctCell = hasExplanation ? cellsRest[cellsRest.length - 2] ?? '' : last;
    const optionCells = cellsRest.slice(0, cellsRest.length - (hasExplanation ? 2 : 1));
    const explanation = hasExplanation ? last : '';

    const options = optionCells
      .map((optionText) => optionText.trim())
      .filter(Boolean)
      .map((optionText, optionIndex) => ({ text: optionText, order: optionIndex + 1 }));

    if (options.length < 2) {
      errors.push(`Строка ${line}: нужно минимум два варианта ответа`);
      return;
    }

    const { indexes, unknown } = resolveCorrect(options, correctCell);

    if (unknown.length > 0 || indexes.size === 0) {
      errors.push(`Строка ${line}: верные варианты не найдены (${correctCell || 'пусто'})`);
      return;
    }

    items.push({
      type: indexes.size === 1 ? 'single' : 'multiple',
      data: { text },
      options: options.map((option, optionIndex) => ({ text: option.text, isCorrect: indexes.has(optionIndex) })),
      pairs: [],
      explanation: explanation ? textToDoc(explanation) : null,
      group: null,
      line,
    });
  });
}

/**
 * Строки CSV → вопросы для блока «Тест».
 *
 * Заголовок первой строки задаёт шаблон (см. комментарий в начале файла).
 * Без заголовка работает старый формат `вопрос; варианты; номера; пояснение`.
 * Возвращает { items, errors }; у каждого вопроса есть `group` (название
 * группы из колонки «Группа») и `line` (номер строки для сообщений).
 */
export function csvToQuestions(rows) {
  const items = [];
  const errors = [];
  const table = (rows ?? []).map((row) => row.map((cell) => String(cell ?? '').trim()));

  if (table.length === 0) return { items, errors };

  const header = readCsvHeader(table[0]);

  if (!header) {
    parseLegacyQuestions(table, items, errors);
    return { items, errors };
  }

  // Пары сопоставления собираются по группе: одна группа — один вопрос.
  const buckets = [];

  // Данные берём только из колонок заголовка: подписи вроде «Пара 1» не в счёт,
  // поэтому строки-заготовки с пустыми парами молча пропускаются.
  const mappedIndexes = [
    header.type,
    header.front,
    header.back,
    header.left,
    header.right,
    header.text,
    header.correct,
    header.explanation,
    header.group,
    ...header.options.map((option) => option.index),
  ].filter((index) => index !== undefined);

  const hasContent = (cells) => mappedIndexes.some((index) => String(cells[index] ?? '').trim() !== '');

  table.slice(1).forEach((cells, index) => {
    const line = index + 2;

    if (!hasContent(cells)) return;

    const markerType = header.type !== undefined ? typeMarker(cells[header.type])?.type ?? null : null;
    const front = cellAt(cells, header.front);
    const back = cellAt(cells, header.back);
    const left = cellAt(cells, header.left);
    const right = cellAt(cells, header.right);
    const text = cellAt(cells, header.text);
    const group = cellAt(cells, header.group) || null;

    const type =
      markerType ??
      (header.left !== undefined && (left || right) ? 'match' : null) ??
      (header.front !== undefined && (front || back) ? 'card' : null) ??
      'quiz';

    if (type === 'card') {
      if (!front && !back) return;

      items.push({ type: 'card', data: { front, back }, options: [], pairs: [], explanation: null, group, line });
      return;
    }

    if (type === 'match') {
      if (!left && !right) return;

      if (!left || !right) {
        errors.push(`Строка ${line}: заполните обе стороны пары`);
        return;
      }

      const key = `${(group ?? '').toLowerCase()}\u0000${text}`;
      let bucket = buckets.find((item) => item.key === key);

      if (!bucket) {
        bucket = { key, group, text, line, pairs: [] };
        buckets.push(bucket);
      }

      bucket.pairs.push({ left, right });
      if (!bucket.text && text) bucket.text = text;
      return;
    }

    const optionList = header.options
      .map(({ index: column, order }) => ({ text: cellAt(cells, column), order }))
      .filter((option) => option.text !== '');

    if (!text) {
      errors.push(`Строка ${line}: пустой текст вопроса`);
      return;
    }

    if (optionList.length < 2) {
      errors.push(`Строка ${line}: нужно минимум два варианта ответа`);
      return;
    }

    const correctCell = cellAt(cells, header.correct);

    if (!correctCell) {
      errors.push(`Строка ${line}: не указан правильный ответ`);
      return;
    }

    const { indexes, unknown } = resolveCorrect(optionList, correctCell);

    if (unknown.length > 0) {
      errors.push(`Строка ${line}: в «Правильном ответе» нет варианта «${unknown.join('», «')}»`);
      return;
    }

    if (indexes.size === 0) {
      errors.push(`Строка ${line}: не указан правильный ответ`);
      return;
    }

    const typeValue =
      markerType === 'single' || markerType === 'multiple' ? markerType : indexes.size === 1 ? 'single' : 'multiple';

    if (typeValue === 'single' && indexes.size !== 1) {
      errors.push(`Строка ${line}: для «Один ответ» нужен ровно один верный вариант`);
      return;
    }

    const explanation = cellAt(cells, header.explanation);

    items.push({
      type: typeValue,
      data: { text },
      options: optionList.map((option, optionIndex) => ({ text: option.text, isCorrect: indexes.has(optionIndex) })),
      pairs: [],
      explanation: explanation ? textToDoc(explanation) : null,
      group,
      line,
    });
  });

  for (const bucket of buckets) {
    if (bucket.pairs.length < 2) {
      const where = bucket.group ? ` в группе «${bucket.group}»` : '';
      errors.push(`Строка ${bucket.line}: для сопоставления нужно минимум две пары${where}`);
      continue;
    }

    items.push({
      type: 'match',
      data: { text: bucket.text || 'Сопоставьте пары' },
      options: [],
      pairs: bucket.pairs,
      explanation: null,
      group: bucket.group,
      line: bucket.line,
    });
  }

  items.sort((a, b) => a.line - b.line);
  return { items, errors };
}

/** Строки CSV → термины глоссария: `термин; определение`. */
export function csvToTerms(rows) {
  const items = [];
  const errors = [];

  (rows ?? []).forEach((row, index) => {
    const line = index + 1;
    const cells = row.map((cell) => String(cell ?? '').trim());

    if (cells.every((cell) => cell === '')) return;
    if (index === 0 && (TERM_HEADER.test(cells[0]) || /^определение$/i.test(cells[1] ?? ''))) return;

    const [term, definition] = cells;

    if (!term) {
      errors.push(`Строка ${line}: пустой термин`);
      return;
    }

    if (!definition) {
      errors.push(`Строка ${line}: нет определения для «${term}»`);
      return;
    }

    items.push({ term, definition: textToDoc(definition), line });
  });

  return { items, errors };
}

/** Ячейка CSV: кавычки, если внутри разделитель, кавычка или перевод строки. */
function csvCell(value) {
  const text = String(value ?? '');
  return /[";\n\r\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvText = (rows) => rows.map((row) => row.map(csvCell).join(';')).join('\r\n');

/** Название группы: у вопроса с сервера это объект, у строки импорта — строка. */
const groupName = (question) => {
  const group = question?.group;
  return typeof group === 'string' ? group : group?.name ?? '';
};
const explanationText = (question) => (question?.explanation ? docToText(question.explanation) : '');

/** Верные варианты → «A|E» для колонки «Правильный ответ». */
const correctText = (options = []) =>
  options
    .filter((option) => option.isCorrect)
    .map((option) => option.text)
    .join('|');

const optionsRange = (count) => Array.from({ length: count }, (_, index) => `Вариант ${index + 1}`);

/**
 * Вопросы → CSV в формате шаблонов.
 * Однотипный тест выгружается компактной таблицей своего шаблона,
 * смешанный — одной таблицей с колонкой «Тип».
 */
export function questionsToCsv(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const quiz = list.filter((question) => question.type === 'single' || question.type === 'multiple');
  const cards = list.filter((question) => question.type === 'card');
  const matches = list.filter((question) => question.type === 'match');
  const kinds = [quiz.length > 0, cards.length > 0, matches.length > 0].filter(Boolean).length;

  if (kinds === 1 && cards.length > 0) {
    return csvText([
      ['Передняя сторона', 'Задняя сторона', 'Группа'],
      ...cards.map((question) => [question.data?.front ?? '', question.data?.back ?? '', groupName(question)]),
    ]);
  }

  if (kinds === 1 && matches.length > 0) {
    const rows = [['', 'Лево', 'Право', 'Группа', 'Вопрос']];
    let label = 0;

    for (const question of matches) {
      for (const pair of question.pairs ?? []) {
        label += 1;
        rows.push([`Пара ${label}`, pair.left, pair.right, groupName(question), question.data?.text ?? '']);
      }
    }

    return csvText(rows);
  }

  const optionCount = Math.min(12, Math.max(2, ...list.map((question) => (question.options ?? []).length)));

  if (kinds === 1) {
    const header = ['Вопрос', ...optionsRange(optionCount), 'Правильный ответ', 'Объяснение', 'Группа'];

    return csvText([
      header,
      ...quiz.map((question) => [
        question.data?.text ?? '',
        ...Array.from({ length: optionCount }, (_, index) => question.options?.[index]?.text ?? ''),
        correctText(question.options),
        explanationText(question),
        groupName(question),
      ]),
    ]);
  }

  const header = [
    'Тип',
    'Передняя сторона',
    'Задняя сторона',
    'Вопрос',
    ...optionsRange(optionCount),
    'Правильный ответ',
    'Объяснение',
    'Лево',
    'Право',
    'Группа',
  ];

  const emptyOptions = Array(optionCount).fill('');
  const rows = [header];

  for (const question of list) {
    if (question.type === 'card') {
      rows.push([
        'карточка',
        question.data?.front ?? '',
        question.data?.back ?? '',
        '',
        ...emptyOptions,
        '',
        '',
        '',
        '',
        groupName(question),
      ]);
      continue;
    }

    if (question.type === 'match') {
      for (const pair of question.pairs ?? []) {
        rows.push([
          'соответствие',
          '',
          '',
          question.data?.text ?? '',
          ...emptyOptions,
          '',
          '',
          pair.left,
          pair.right,
          groupName(question),
        ]);
      }
      continue;
    }

    rows.push([
      question.type === 'multiple' ? 'несколько ответов' : 'один ответ',
      '',
      '',
      question.data?.text ?? '',
      ...Array.from({ length: optionCount }, (_, index) => question.options?.[index]?.text ?? ''),
      correctText(question.options),
      explanationText(question),
      '',
      '',
      groupName(question),
    ]);
  }

  return csvText(rows);
}

/** Строка шаблона вопроса: 12 колонок вариантов, как в Excel-заготовке. */
const quizRow = (text, options, correct, explanation, group) => [
  text,
  ...options,
  ...Array(12 - options.length).fill(''),
  correct,
  explanation,
  group,
];

/** Шаблоны CSV, которые редактор предлагает скачать в модалке импорта. */
export const TEST_CSV_TEMPLATES = [
  {
    id: 'quiz',
    name: 'Вопросы',
    fileName: 'Вопрос одиночный или множественный.csv',
    columns: 'Вопрос; Вариант 1 … Вариант 12; Правильный ответ; Объяснение; Группа',
    content: csvText([
      ['Вопрос', ...optionsRange(12), 'Правильный ответ', 'Объяснение', 'Группа'],
      quizRow('Какой артикль перед cat?', ['A', 'An', 'The', '-'], 'A', 'Перед согласными — A', 'Артикли'),
      quizRow('Выберите гласные', ['A', 'E', 'F', 'G'], 'A|E', 'A и E — гласные', 'Буквы'),
    ]),
  },
  {
    id: 'cards',
    name: 'Карточки',
    fileName: 'Карточки.csv',
    columns: 'Передняя сторона; Задняя сторона; Группа',
    content: csvText([
      ['Передняя сторона', 'Задняя сторона', 'Группа'],
      ['nature', 'природа', 'Слова'],
      ['wool', 'шерсть', 'Слова'],
    ]),
  },
  {
    id: 'match',
    name: 'Соответствие',
    fileName: 'Соответствие.csv',
    columns: '; Лево; Право; Группа — одна пара на строку',
    content: csvText([
      ['', 'Лево', 'Право', 'Группа'],
      ['Пара 1', 'cat', 'кошка', 'Слова'],
      ['Пара 2', 'dog', 'собака', 'Слова'],
      ['Пара 3', 'wool', 'шерсть', 'Слова'],
    ]),
  },
];

/** Подсказка о поддерживаемых форматах для модалки импорта. */
export const QUESTIONS_CSV_HINT =
  'Шаблоны: вопросы (варианты + правильный ответ), карточки, соответствие. Группа из колонки «Группа» создаётся автоматически. Без заголовка — «вопрос; варианты; номера верных; пояснение».';

/** Скачать CSV-файл (с BOM, чтобы Excel открыл кириллицу). */
export function downloadCsvFile(fileName, content) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
