/**
 * Формат архива курса (Шаг 13) и его разбор.
 *
 * Архив — обычный ZIP с манифестом course.json в корне (или в единственной
 * вложенной папке курса) и картинками в files/:
 *
 *   course.zip
 *   ├── course.json
 *   └── files/<имя>
 *
 * Разбор ничего не пишет ни в БД, ни на диск: сначала архив целиком проверяется
 * и нормализуется, и только потом контроллер создаёт курс одной транзакцией
 * (алгоритм 2.14 — «сначала проверка, потом запись»). Ошибка в любом месте
 * архива возвращает 400 с путём до проблемного поля и не оставляет мусора.
 *
 * Порядок элементов в архиве задают массивы: order выставляется по индексу,
 * поэтому в course.json его нет.
 */
import path from 'node:path';
import AdmZip from 'adm-zip';
import { BLOCK_LIMITS, BLOCK_TYPES, textField } from './blocks.js';
import {
  CONTENT_TYPES,
  CONTENT_WIDTHS,
  CURRENT_DATA_VERSION,
  normalizeContentData,
} from './content.js';
import { normalizeQuestion } from './questions.js';
import { normalizeContentBody } from './contentBody.js';
import { docToText, normalizeDoc } from './tiptap.js';
import { IMAGE_MIME_EXT, MAX_IMAGE_SIZE } from './uploads.js';

/** Метка формата в course.json. */
export const ARCHIVE_FORMAT = 'course-builder';

/** Версия формата, которую понимает сервер. */
export const ARCHIVE_VERSION = 1;

/** Ограничения размеров: ZIP и суммарный размер распакованных записей. */
export const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;
export const MAX_UNPACKED_SIZE = 150 * 1024 * 1024;

/** Лимиты количества сущностей в одном архиве. */
export const ARCHIVE_LIMITS = {
  blocks: 200,
  groups: 200,
  sections: 100,
  slides: 500,
  contents: 5000,
  questions: 2000,
  memoSlides: 500,
  memoCells: 2000,
  terms: 5000,
  files: 500,
};

/** Длины текстовых полей — те же, что в правилах валидации API. */
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const COVER_MAX = 500;
const QUESTION_SECTION_TITLE_MAX = 200;

const MB = 1024 * 1024;

const fail = (message, errors) => ({ ok: false, message, ...(errors ? { errors } : {}) });

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const optionalText = (value, max) => {
  if (value === undefined || value === null) return null;
  return textField(value, max) || null;
};

/** Увеличивает счётчик сущностей и проверяет лимит. Возвращает текст ошибки или null. */
function bump(counters, name, limit, label) {
  counters[name] += 1;
  return counters[name] > limit ? `${label}: больше ${limit} элементов в одном архиве` : null;
}

/** Путь внутри архива: без ведущих слэшей, обратных слэшей и «..». */
function normalizeEntryName(name) {
  const normalized = String(name ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!normalized) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

/** course.json в корне архива или в единственной папке верхнего уровня. */
function findManifest(entries) {
  const direct = entries.find((entry) => entry.entryName === 'course.json');
  if (direct) return direct;

  const nested = entries.filter((entry) => entry.entryName.endsWith('/course.json'));
  if (nested.length !== 1) return null;

  return nested[0].entryName.split('/').length === 2 ? nested[0] : null;
}


/**
 * Картинки архива: записи манифеста `files` сопоставляются с файлами ZIP.
 * Ключи (старый id и старый url) нужны контроллеру, чтобы заменить ссылки
 * в контенте на новые.
 */
function readArchiveFiles(entries, manifestFiles, baseDir) {
  const byName = new Map(entries.map((entry) => [entry.entryName, entry]));
  const list = Array.isArray(manifestFiles) ? manifestFiles : [];

  if (list.length > ARCHIVE_LIMITS.files) {
    return fail(`Файлы: больше ${ARCHIVE_LIMITS.files} картинок в одном архиве`);
  }

  const files = [];
  const keys = new Set();

  for (const [index, item] of list.entries()) {
    const label = `files[${index}]`;

    if (!isPlainObject(item)) return fail(`${label}: ожидается объект`);

    const name = normalizeEntryName(item.name);
    if (!name) return fail(`${label}.name: некорректный путь в архиве`);

    const entry = byName.get(baseDir ? `${baseDir}/${name}` : name) ?? byName.get(name);
    if (!entry) return fail(`${label}: в архиве нет файла ${name}`);

    const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
    if (!IMAGE_MIME_EXT[mimeType]) {
      return fail(`${label}.mimeType: поддерживаются только PNG, JPEG, WebP и GIF`);
    }

    const buffer = entry.getData();
    if (buffer.length === 0) return fail(`${label}: файл ${name} пустой`);
    if (buffer.length > MAX_IMAGE_SIZE) {
      return fail(`${label}: файл ${name} больше ${MAX_IMAGE_SIZE / MB} МБ`);
    }

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    const url = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : '';
    const fileKeys = [id, url].filter(Boolean);

    if (fileKeys.length === 0) return fail(`${label}: нужен id или path исходного файла`);

    for (const key of fileKeys) {
      if (keys.has(key)) return fail(`${label}: повторяющаяся ссылка на файл (${key})`);
      keys.add(key);
    }

    files.push({ keys: fileKeys, name, mimeType, buffer, size: buffer.length });
  }

  return { ok: true, files };
}
/**
 * Проверка ссылок картинки: fileId и /uploads/... должны быть в архиве,
 * иначе после импорта получилась бы битая картинка.
 */
function checkImageRefs(data, knownFiles) {
  if (data.fileId && !knownFiles.has(data.fileId)) {
    return `файл ${data.fileId} отсутствует в архиве`;
  }

  const url = typeof data.url === 'string' ? data.url.trim() : '';
  if (url.startsWith('/uploads/') && !knownFiles.has(url)) {
    return `файл ${url} отсутствует в архиве`;
  }

  return null;
}

/** Один фрагмент контента слайда: тип, нормализованные data и ширина. */
function normalizeContentItem(item, label, knownFiles, counters) {
  if (!isPlainObject(item)) return fail(`${label}: ожидается объект`);

  const type = typeof item.type === 'string' ? item.type : '';
  if (!CONTENT_TYPES.includes(type)) {
    return fail(`${label}.type: допустимые значения — ${CONTENT_TYPES.join(', ')}`);
  }

  const limitError = bump(counters, 'contents', ARCHIVE_LIMITS.contents, 'Контент');
  if (limitError) return fail(limitError);

  const version = item.dataVersion === undefined ? CURRENT_DATA_VERSION : Number(item.dataVersion);
  if (!Number.isInteger(version) || version < 1) {
    return fail(`${label}.dataVersion: ожидается целое число`);
  }
  if (version > CURRENT_DATA_VERSION) {
    return fail(`${label}.dataVersion: данные новее, чем понимает сервер (${CURRENT_DATA_VERSION})`);
  }

  const normalized = normalizeContentData(type, item.data);
  if (!normalized.ok) return fail(`${label}.data: ${normalized.message}`);

  if (type === 'image') {
    const refError = checkImageRefs(normalized.data, knownFiles);
    if (refError) return fail(`${label}.data: ${refError}`);
  }

  const width = CONTENT_WIDTHS.includes(Number(item.width)) ? Number(item.width) : 100;

  return { ok: true, content: { type, data: normalized.data, width } };
}

/** Слайд теории: необязательный заголовок и список фрагментов. */
function normalizeSlide(slide, label, knownFiles, counters) {
  if (!isPlainObject(slide)) return fail(`${label}: ожидается объект`);

  const limitError = bump(counters, 'slides', ARCHIVE_LIMITS.slides, 'Слайды');
  if (limitError) return fail(limitError);

  const list = Array.isArray(slide.contents) ? slide.contents : [];
  const contents = [];

  for (const [index, item] of list.entries()) {
    const result = normalizeContentItem(item, `${label}.contents[${index}]`, knownFiles, counters);
    if (!result.ok) return result;
    contents.push(result.content);
  }

  return { ok: true, slide: { title: optionalText(slide.title, TITLE_MAX), contents } };
}

/** Группы теста: только названия, порядок — по индексу. */
function normalizeGroups(rawGroups, label, counters) {
  const list = Array.isArray(rawGroups) ? rawGroups : [];
  const groups = [];

  for (const [index, group] of list.entries()) {
    const limitError = bump(counters, 'groups', ARCHIVE_LIMITS.groups, 'Группы');
    if (limitError) return fail(limitError);

    const name = textField(group?.name, BLOCK_LIMITS.groupName);
    if (!name) return fail(`${label}.groups[${index}].name: обязательное поле`);

    groups.push({ name });
  }

  return { ok: true, groups };
}

/**
 * Разделы теста (точки ветвления): название и необязательный итоговый
 * комментарий. Порядок — по индексу массива, как у групп.
 */
function normalizeSections(rawSections, label, counters) {
  const list = Array.isArray(rawSections) ? rawSections : [];
  const sections = [];

  for (const [index, section] of list.entries()) {
    const limitError = bump(counters, 'sections', ARCHIVE_LIMITS.sections, 'Разделы');
    if (limitError) return fail(limitError);

    if (!isPlainObject(section)) return fail(`${label}.sections[${index}]: ожидается объект`);

    const title = textField(section.title, QUESTION_SECTION_TITLE_MAX);
    if (!title) return fail(`${label}.sections[${index}].title: обязательное поле`);

    let result = null;
    if (section.result !== undefined && section.result !== null) {
      const parsed = normalizeDoc(section.result);
      if (!parsed.ok) return fail(`${label}.sections[${index}].result: ${parsed.message}`);
      result = parsed.doc;
    }

    sections.push({ title, result });
  }

  return { ok: true, sections };
}

/** Настройки теста: три тумблера и итоговый комментарий всего теста. */
function normalizeSettings(rawSettings, label) {
  if (rawSettings === undefined || rawSettings === null) return { ok: true, settings: null };
  if (!isPlainObject(rawSettings)) return fail(`${label}.settings: ожидается объект`);

  let result = null;
  if (rawSettings.result !== undefined && rawSettings.result !== null) {
    const parsed = normalizeDoc(rawSettings.result);
    if (!parsed.ok) return fail(`${label}.settings.result: ${parsed.message}`);
    result = parsed.doc;
  }

  return {
    ok: true,
    settings: {
      shuffleQuestions: Boolean(rawSettings.shuffleQuestions),
      shuffleOptions: Boolean(rawSettings.shuffleOptions),
      branching: Boolean(rawSettings.branching),
      result,
    },
  };
}

/** Картинка стороны карточки — ссылка /uploads/... должна быть в архиве. */
function checkSideImageRef(value, knownFiles) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (url.startsWith('/uploads/') && !knownFiles.has(url)) {
    return `файл ${url} отсутствует в архиве`;
  }
  return null;
}

function normalizeQuestionItem(item, label, groupCount, sectionCount, knownFiles, counters) {
  if (!isPlainObject(item)) return fail(`${label}: ожидается объект`);

  const limitError = bump(counters, 'questions', ARCHIVE_LIMITS.questions, 'Вопросы');
  if (limitError) return fail(limitError);

  const normalized = normalizeQuestion(item.type, {
    data: item.data,
    options: item.options,
    pairs: item.pairs,
    explanation: item.explanation,
  });

  if (!normalized.ok) return fail(`${label}: ${normalized.message}`);

  if (normalized.type === 'card') {
    for (const key of ['frontImage', 'backImage']) {
      const refError = checkSideImageRef(normalized.data[key], knownFiles);
      if (refError) return fail(`${label}.data.${key}: ${refError}`);
    }
  }

  let groupIndex = null;

  if (item.groupIndex !== undefined && item.groupIndex !== null) {
    const index = Number(item.groupIndex);

    if (!Number.isInteger(index) || index < 0 || index >= groupCount) {
      return fail(`${label}.groupIndex: в блоке нет группы с таким индексом`);
    }

    groupIndex = index;
  }

  let sectionIndex = null;

  if (item.sectionIndex !== undefined && item.sectionIndex !== null) {
    const index = Number(item.sectionIndex);

    if (!Number.isInteger(index) || index < 0 || index >= sectionCount) {
      return fail(`${label}.sectionIndex: в блоке нет раздела с таким индексом`);
    }

    sectionIndex = index;
  }

  const options = [];

  for (const [index, option] of normalized.options.entries()) {
    const targetIndex = option.targetSectionIndex;

    if (option.targetType === 'section') {
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= sectionCount) {
        return fail(`${label}.options[${index}].targetSectionIndex: в блоке нет раздела с таким индексом`);
      }

      options.push({ text: option.text, isCorrect: option.isCorrect, targetType: 'section', targetIndex });
      continue;
    }

    options.push({
      text: option.text,
      isCorrect: option.isCorrect,
      targetType: option.targetType === 'submit' ? 'submit' : 'next',
    });
  }

  return {
    ok: true,
    question: {
      type: normalized.type,
      data: normalized.data,
      explanation: normalized.explanation,
      options,
      pairs: normalized.pairs,
      groupIndex,
      sectionIndex,
    },
  };
}

/**
 * Карточки слайда памятки: заголовок (простой текст и, если есть, Tiptap-разметка)
 * и тело из фрагментов. `titleDoc` необязателен — старые архивы знают только title.
 */
function normalizeMemoCards(rawCells, label, counters) {
  const list = Array.isArray(rawCells) ? rawCells : [];
  const cells = [];

  for (const [index, cell] of list.entries()) {
    const limitError = bump(counters, 'memoCells', ARCHIVE_LIMITS.memoCells, 'Карточки памятки');
    if (limitError) return fail(limitError);

    const body = normalizeContentBody(cell?.body);
    if (!body.ok) return fail(`${label}[${index}].body: ${body.message}`);

    let title = textField(cell?.title, BLOCK_LIMITS.memoTitle) || 'Новая карточка';
    let titleDoc = null;

    if (cell?.titleDoc !== undefined && cell?.titleDoc !== null) {
      const parsed = normalizeDoc(cell.titleDoc);
      if (!parsed.ok) return fail(`${label}[${index}].titleDoc: ${parsed.message}`);

      const plain = docToText(parsed.doc).slice(0, BLOCK_LIMITS.memoTitle);
      if (!plain) return fail(`${label}[${index}].titleDoc: заголовок пуст`);

      title = plain;
      titleDoc = parsed.doc;
    }

    cells.push({
      title,
      titleDoc,
      body: body.body,
    });
  }

  return { ok: true, cells };
}

/**
 * Слайды памятки: заголовок слайда и его карточки.
 * Старый архив без memoSlides (только плоский memoCells) читается как один
 * слайд «Слайд 1» — формат обратно совместим.
 */
function normalizeMemoSlides(rawSlides, rawCells, label, counters) {
  const list = Array.isArray(rawSlides)
    ? rawSlides
    : Array.isArray(rawCells)
      ? [{ title: 'Слайд 1', cells: rawCells }]
      : [];

  const slides = [];

  for (const [index, slide] of list.entries()) {
    const limitError = bump(counters, 'memoSlides', ARCHIVE_LIMITS.memoSlides, 'Слайды памятки');
    if (limitError) return fail(limitError);

    if (!isPlainObject(slide)) return fail(`${label}.memoSlides[${index}]: ожидается объект`);

    const cards = normalizeMemoCards(slide.cells, `${label}.memoSlides[${index}].cells`, counters);
    if (!cards.ok) return cards;

    slides.push({
      title: textField(slide.title, BLOCK_LIMITS.memoTitle) || 'Новый слайд',
      cells: cards.cells,
    });
  }

  return { ok: true, memoSlides: slides };
}

/** Термины глоссария: термин и Tiptap-определение. */
function normalizeTerms(rawTerms, label, counters) {
  const list = Array.isArray(rawTerms) ? rawTerms : [];
  const terms = [];

  for (const [index, item] of list.entries()) {
    const limitError = bump(counters, 'terms', ARCHIVE_LIMITS.terms, 'Термины');
    if (limitError) return fail(limitError);

    const term = textField(item?.term, BLOCK_LIMITS.term);
    if (!term) return fail(`${label}.terms[${index}].term: термин не может быть пустым`);

    const definition = normalizeContentBody(item?.definition);
    if (!definition.ok) return fail(`${label}.terms[${index}].definition: ${definition.message}`);

    terms.push({ term, definition: definition.body });
  }

  return { ok: true, terms };
}


/** Блок любого типа: общие поля + содержимое, допустимое только для этого типа. */
function normalizeBlock(block, label, knownFiles, counters) {
  if (!isPlainObject(block)) return fail(`${label}: ожидается объект`);

  const type = typeof block.type === 'string' ? block.type : '';
  if (!BLOCK_TYPES.includes(type)) {
    return fail(`${label}.type: допустимые значения — ${BLOCK_TYPES.join(', ')}`);
  }

  const limitError = bump(counters, 'blocks', ARCHIVE_LIMITS.blocks, 'Блоки');
  if (limitError) return fail(limitError);

  const title = textField(block.title, TITLE_MAX);
  if (!title) return fail(`${label}.title: обязательное поле`);

  const result = {
    type,
    title,
    description: optionalText(block.description, DESCRIPTION_MAX),
    coverImage: optionalText(block.coverImage, COVER_MAX),
    slides: [],
    groups: [],
    sections: [],
    settings: null,
    questions: [],
    memoSlides: [],
    memoCells: [],
    terms: [],
  };

  const allowed = {
    theory: ['slides'],
    test: ['groups', 'sections', 'questions'],
    memo: ['memoSlides', 'memoCells'],
    glossary: ['terms'],
  }[type];

  const unexpected = ['slides', 'groups', 'sections', 'questions', 'memoSlides', 'memoCells', 'terms'].filter(
    (key) => !allowed.includes(key) && Array.isArray(block[key]) && block[key].length > 0,
  );

  if (unexpected.length > 0) {
    return fail(`${label}.${unexpected[0]}: блок типа «${type}» не может содержать такое содержимое`);
  }

  if (type === 'theory') {
    const list = Array.isArray(block.slides) ? block.slides : [];

    for (const [index, slide] of list.entries()) {
      const normalized = normalizeSlide(slide, `${label}.slides[${index}]`, knownFiles, counters);
      if (!normalized.ok) return normalized;
      result.slides.push(normalized.slide);
    }
  }

  if (type === 'test') {
    const groups = normalizeGroups(block.groups, label, counters);
    if (!groups.ok) return groups;
    result.groups = groups.groups;

    const sections = normalizeSections(block.sections, label, counters);
    if (!sections.ok) return sections;
    result.sections = sections.sections;

    const settings = normalizeSettings(block.settings, label);
    if (!settings.ok) return settings;
    result.settings = settings.settings;

    const list = Array.isArray(block.questions) ? block.questions : [];

    for (const [index, question] of list.entries()) {
      const normalized = normalizeQuestionItem(
        question,
        `${label}.questions[${index}]`,
        result.groups.length,
        result.sections.length,
        knownFiles,
        counters,
      );
      if (!normalized.ok) return normalized;
      result.questions.push(normalized.question);
    }
  }

  if (type === 'memo') {
    const memo = normalizeMemoSlides(block.memoSlides, block.memoCells, label, counters);
    if (!memo.ok) return memo;
    result.memoSlides = memo.memoSlides;
    result.memoCells = memo.memoSlides.flatMap((slide) => slide.cells);
  }

  if (type === 'glossary') {
    const terms = normalizeTerms(block.terms, label, counters);
    if (!terms.ok) return terms;
    result.terms = terms.terms;
  }

  return { ok: true, block: result };
}

/**
 * Блок из отдельного JSON-файла (не из архива курса): правила те же, что у
 * блока архива, но картинки не упакованы в files/ — они уже лежат в uploads.
 * knownFiles — набор fileId и путей `/uploads/...`, которые есть на сервере.
 */
export function readBlockManifest(rawBlock, knownFiles = new Set()) {
  const counters = {
    blocks: 0,
    groups: 0,
    sections: 0,
    slides: 0,
    contents: 0,
    questions: 0,
    memoSlides: 0,
    memoCells: 0,
    terms: 0,
  };

  const normalized = normalizeBlock(rawBlock, 'block', knownFiles, counters);
  if (!normalized.ok) return normalized;

  return { ok: true, block: normalized.block };
}

/**
 * Разбор ZIP-архива курса.
 * Возвращает { ok: true, archive: { course, blocks, files } } либо
 * { ok: false, message, errors? } — без записи в БД и на диск.
 */
export function readCourseArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return fail('Архив не передан');

  if (buffer.length > MAX_ARCHIVE_SIZE) {
    return fail(`Архив больше ${MAX_ARCHIVE_SIZE / MB} МБ`);
  }

  // ZIP всегда начинается с сигнатуры «PK».
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return fail('Ожидается ZIP-архив (.zip)');

  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return fail('Не удалось прочитать ZIP-архив');
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0) return fail('Архив пуст');

  const unpackedSize = entries.reduce((sum, entry) => sum + (entry.header?.size ?? 0), 0);
  if (unpackedSize > MAX_UNPACKED_SIZE) {
    return fail(`Распакованный архив больше ${MAX_UNPACKED_SIZE / MB} МБ`);
  }

  const manifestEntry = findManifest(entries);
  if (!manifestEntry) {
    return fail('В архиве нет course.json — он должен лежать в корне или в единственной папке курса');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fail('course.json — некорректный JSON');
  }

  if (!isPlainObject(manifest)) return fail('course.json: ожидается объект');

  if (manifest.format !== undefined && manifest.format !== ARCHIVE_FORMAT) {
    return fail(`course.json: неизвестный формат архива — ${String(manifest.format)}`);
  }

  const version = manifest.version === undefined ? ARCHIVE_VERSION : Number(manifest.version);

  if (!Number.isInteger(version) || version < 1) {
    return fail('course.json: version — целое число от 1');
  }

  if (version > ARCHIVE_VERSION) {
    return fail(`course.json: версия архива ${version} новее поддерживаемой (${ARCHIVE_VERSION})`);
  }

  const baseDir = path.posix.dirname(manifestEntry.entryName);
  const rootDir = baseDir === '.' ? '' : baseDir;

  const filesResult = readArchiveFiles(entries, manifest.files, rootDir);
  if (!filesResult.ok) return filesResult;

  const knownFiles = new Set(filesResult.files.flatMap((file) => file.keys));

  if (!isPlainObject(manifest.course)) return fail('course.json: нет объекта course');

  const title = textField(manifest.course.title, TITLE_MAX);
  if (!title) return fail('course.title: обязательное поле');

  const counters = {
    blocks: 0,
    groups: 0,
    sections: 0,
    slides: 0,
    contents: 0,
    questions: 0,
    memoSlides: 0,
    memoCells: 0,
    terms: 0,
  };
  const blocks = [];
  const list = Array.isArray(manifest.blocks) ? manifest.blocks : [];

  for (const [index, block] of list.entries()) {
    const normalized = normalizeBlock(block, `blocks[${index}]`, knownFiles, counters);
    if (!normalized.ok) return normalized;
    blocks.push(normalized.block);
  }

  return {
    ok: true,
    archive: {
      course: { title, description: optionalText(manifest.course.description, DESCRIPTION_MAX) },
      blocks,
      files: filesResult.files,
    },
  };
}

