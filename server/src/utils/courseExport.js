/**
 * Экспорт курса в ZIP-архив (Шаг 14) — операция, обратная импорту Шага 13.
 *
 * Архив получается ровно в том формате, который читает `readCourseArchive`:
 *
 *   course.zip
 *   ├── course.json
 *   └── files/<имя>
 *
 * Поэтому экспорт → импорт даёт эквивалентный курс, а `course.json` из архива
 * проходит тот же валидатор, что и пользовательский импорт (это проверяет
 * smoke-step14). Порядок сущностей задаётся массивами (orderBy в запросе),
 * `order` в манифест не попадает; у вопросов вместо `groupId` — `groupIndex`.
 *
 * Картинки берутся из server/uploads и попадают в архив под своим именем;
 * ссылки в манифесте (fileId и /uploads/...) — исходные, их заменяет импорт.
 * Если файл из БД отсутствует на диске, архив собрать нельзя: импорт такого
 * архива вернул бы 400, поэтому экспорт честно отвечает 409.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_LIMITS,
  ARCHIVE_VERSION,
  MAX_ARCHIVE_SIZE,
  MAX_UNPACKED_SIZE,
} from './courseArchive.js';
import { MAX_IMAGE_SIZE, UPLOADS_DIR } from './uploads.js';

const MB = 1024 * 1024;

/** Ошибка экспорта: 409 — состояние данных мешает собрать корректный архив. */
const fail = (message) => ({ ok: false, status: 409, message });

/** Курс целиком, в порядке отображения (orderBy у всех коллекций). */
export const COURSE_EXPORT_SELECT = {
  id: true,
  title: true,
  description: true,
  blocks: {
    orderBy: { order: 'asc' },
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      coverImage: true,
      slides: {
        orderBy: { order: 'asc' },
        select: {
          title: true,
          contents: {
            orderBy: { order: 'asc' },
            select: { type: true, data: true, dataVersion: true, width: true },
          },
        },
      },
      groups: { orderBy: { order: 'asc' }, select: { id: true, name: true } },
      sections: { orderBy: { order: 'asc' }, select: { id: true, title: true, result: true } },
      testSettings: {
        select: { shuffleQuestions: true, shuffleOptions: true, branching: true, result: true },
      },
      questions: {
        orderBy: { order: 'asc' },
        select: {
          type: true,
          data: true,
          explanation: true,
          groupId: true,
          sectionId: true,
          options: {
            orderBy: { order: 'asc' },
            select: { text: true, isCorrect: true, targetType: true, targetSectionId: true },
          },
          pairs: { orderBy: { order: 'asc' }, select: { left: true, right: true } },
        },
      },
      memoSlides: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          cells: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { title: true, titleDoc: true, body: true } },
        },
      },
      terms: { select: { term: true, definition: true } },
    },
  },
};

const isUploadPath = (value) => typeof value === 'string' && value.startsWith('/uploads/');

/**
 * Ссылки на файлы в курсе: id картинок и пути /uploads/... (контент + обложки).
 * Контроллер по ним достаёт записи File из БД.
 */
export function collectFileRefs(course) {
  const ids = new Set();
  const paths = new Set();

  const addImage = (data) => {
    if (typeof data?.fileId === 'string' && data.fileId) ids.add(data.fileId);

    const url = typeof data?.url === 'string' ? data.url.trim() : '';
    if (isUploadPath(url)) paths.add(url);
  };

  for (const block of course.blocks ?? []) {
    if (isUploadPath(block.coverImage)) paths.add(block.coverImage);

    for (const slide of block.slides ?? []) {
      for (const content of slide.contents ?? []) {
        if (content.type === 'image') addImage(content.data);
      }
    }

    // Карточки теста: изображения сторон хранятся ссылками /uploads/...
    for (const question of block.questions ?? []) {
      if (question.type !== 'card') continue;
      for (const key of ['frontImage', 'backImage']) {
        const url = typeof question.data?.[key] === 'string' ? question.data[key].trim() : '';
        if (isUploadPath(url)) paths.add(url);
      }
    }
  }

  return { ids, paths };
}

/** Имя файла внутри архива: только безопасные символы, без коллизий. */
function archiveFileName(originalName, taken) {
  const base = String(originalName ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._]+/, '')
    .slice(-80);
  const safe = base || 'image';
  const ext = path.extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;

  let name = safe;
  let index = 1;
  while (taken.has(name)) {
    name = `${stem}-${index}${ext}`;
    index += 1;
  }

  taken.add(name);
  return name;
}

/** Читаемое имя для скачивания: без запрещённых в файловой системе символов. */
export function downloadFileName(title) {
  const clean = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${clean || 'course'}.zip`;
}

/** ASCII-имя для заголовка Content-Disposition (кириллица уходит в filename*). */
function asciiFileName(title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${slug || 'course'}.zip`;
}

/**
 * Манифест одного блока: общие поля + содержимое, допустимое для его типа.
 * resolveImage(data, url?) — как картинку положить в архив; функция экспорта
 * одного блока (blockTransferController) передаёт заглушку «файл уже на сервере».
 */
export function buildBlockManifest(block, resolveImage) {
  const result = { type: block.type, title: block.title };

  if (block.description) result.description = block.description;

  if (block.coverImage) {
    const cover = isUploadPath(block.coverImage) ? resolveImage(null, block.coverImage) : null;
    result.coverImage = cover?.file ? cover.file.path : block.coverImage;
  }

  if (block.type === 'theory') {
    result.slides = block.slides.map((slide) => ({
      ...(slide.title ? { title: slide.title } : {}),
      contents: slide.contents.map((content) => {
        const item = {
          type: content.type,
          ...(content.width && content.width !== 100 ? { width: content.width } : {}),
          ...(content.dataVersion ? { dataVersion: content.dataVersion } : {}),
        };

        if (content.type === 'image') {
          const resolved = resolveImage(content.data);
          item.data = resolved ? resolved.data : content.data;
        } else {
          item.data = content.data;
        }

        return item;
      }),
    }));
  }

  if (block.type === 'test') {
    const groupIndexes = new Map(block.groups.map((group, index) => [group.id, index]));
    const sectionIndexes = new Map((block.sections ?? []).map((section, index) => [section.id, index]));

    result.groups = block.groups.map((group) => ({ name: group.name }));

    if ((block.sections ?? []).length > 0) {
      result.sections = block.sections.map((section) => ({
        title: section.title,
        ...(section.result ? { result: section.result } : {}),
      }));
    }

    const settings = block.testSettings;
    if (settings) {
      const serialized = {
        shuffleQuestions: Boolean(settings.shuffleQuestions),
        shuffleOptions: Boolean(settings.shuffleOptions),
        branching: Boolean(settings.branching),
        ...(settings.result ? { result: settings.result } : {}),
      };

      if (serialized.shuffleQuestions || serialized.shuffleOptions || serialized.branching || serialized.result) {
        result.settings = serialized;
      }
    }

    result.questions = block.questions.map((question) => {
      const data = { ...question.data };

      // Изображения сторон карточки лежат в архиве рядом с остальными файлами.
      if (question.type === 'card') {
        for (const key of ['frontImage', 'backImage']) {
          if (!isUploadPath(data[key])) continue;
          const resolved = resolveImage(null, data[key]);
          data[key] = resolved?.file ? resolved.file.path : data[key];
        }
      }

      const item = { type: question.type, data };

      if (question.explanation) item.explanation = question.explanation;
      if (question.options.length > 0) {
        item.options = question.options.map(({ text, isCorrect, targetType, targetSectionId }) => {
          const option = { text, isCorrect };

          if (targetType === 'section') {
            const index = targetSectionId ? sectionIndexes.get(targetSectionId) : undefined;
            if (index !== undefined) {
              option.targetType = 'section';
              option.targetSectionIndex = index;
            }
          } else if (targetType === 'submit') {
            option.targetType = 'submit';
          }

          return option;
        });
      }
      if (question.pairs.length > 0) {
        item.pairs = question.pairs.map(({ left, right }) => ({ left, right }));
      }

      const groupIndex = question.groupId ? groupIndexes.get(question.groupId) : undefined;
      if (groupIndex !== undefined) item.groupIndex = groupIndex;

      const sectionIndex = question.sectionId ? sectionIndexes.get(question.sectionId) : undefined;
      if (sectionIndex !== undefined) item.sectionIndex = sectionIndex;

      return item;
    });
  }

  if (block.type === 'memo') {
    result.memoSlides = block.memoSlides.map((slide) => ({
      title: slide.title,
      cells: slide.cells.map((cell) => ({
        title: cell.title,
        ...(cell.titleDoc ? { titleDoc: cell.titleDoc } : {}),
        body: cell.body,
      })),
    }));
  }

  if (block.type === 'glossary') {
    result.terms = block.terms.map((term) => ({ term: term.term, definition: term.definition }));
  }

  return result;
}

/**
 * Собирает ZIP-архив курса.
 * course — результат запроса с COURSE_EXPORT_SELECT, files — записи File,
 * найденные по ссылкам из collectFileRefs.
 * Возвращает { ok, buffer, manifest, filename, downloadName, stats } |
 * { ok: false, status, message } — без записи в БД.
 */
export function buildCourseArchive(course, files = []) {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const taken = new Set();
  const used = new Map();

  /** Кладёт файл в архив (один раз). */
  function addFile(file) {
    if (used.has(file.id)) return;

    const diskName = path.basename(file.path);
    let buffer;

    try {
      buffer = fs.readFileSync(path.join(UPLOADS_DIR, diskName));
    } catch {
      throw Object.assign(new Error('file-missing'), {
        detail: `Файл ${file.path} отсутствует в папке загрузок — экспорт невозможен`,
      });
    }

    if (buffer.length === 0) {
      throw Object.assign(new Error('file-missing'), {
        detail: `Файл ${file.path} пустой — экспорт невозможен`,
      });
    }

    if (buffer.length > MAX_IMAGE_SIZE) {
      throw Object.assign(new Error('file-missing'), {
        detail: `Файл ${file.path} больше ${MAX_IMAGE_SIZE / MB} МБ — экспорт невозможен`,
      });
    }

    used.set(file.id, { file, buffer, name: archiveFileName(diskName, taken) });
  }

  /** Картинка контента: fileId → запись File, иначе /uploads/... → запись File. */
  function resolveImage(data, url = data?.url) {
    const fileId = typeof data?.fileId === 'string' ? data.fileId : '';
    const rawUrl = typeof url === 'string' ? url.trim() : '';

    // Пустая или внешняя ссылка — картинка не из uploads, копируем как есть.
    if (!fileId && !isUploadPath(rawUrl)) return data ? { file: null, data } : null;

    const byId = fileId ? filesById.get(fileId) : null;
    const byPath = !byId && isUploadPath(rawUrl) ? filesByPath.get(rawUrl) : null;
    const file = byId ?? byPath;

    if (!file) {
      throw Object.assign(new Error('file-missing'), {
        detail: `Ссылка на файл ${rawUrl || fileId} не найдена в базе — экспорт невозможен`,
      });
    }

    addFile(file);
    return { file, data: { ...data, fileId: file.id, url: file.path } };
  }

  const blocks = [];

  for (const block of course.blocks ?? []) {
    try {
      blocks.push(buildBlockManifest(block, resolveImage));
    } catch (error) {
      if (error.message === 'file-missing') return fail(error.detail);
      throw error;
    }
  }

  if (blocks.length > ARCHIVE_LIMITS.blocks) {
    return fail(`В курсе больше ${ARCHIVE_LIMITS.blocks} блоков — такой архив не импортируется`);
  }

  if (used.size > ARCHIVE_LIMITS.files) {
    return fail(`В курсе больше ${ARCHIVE_LIMITS.files} картинок — такой архив не импортируется`);
  }

  const manifestFiles = [];
  const zip = new AdmZip();
  let unpacked = 0;

  for (const { file, buffer, name } of used.values()) {
    const entryName = `files/${name}`;
    zip.addFile(entryName, buffer);
    unpacked += buffer.length;
    manifestFiles.push({ id: file.id, path: file.path, name: entryName, mimeType: file.mimeType });
  }

  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    course: {
      title: course.title,
      ...(course.description ? { description: course.description } : {}),
    },
    files: manifestFiles,
    blocks,
  };

  zip.addFile('course.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

  const buffer = zip.toBuffer();

  if (unpacked > MAX_UNPACKED_SIZE) {
    return fail(`Содержимое курса больше ${MAX_UNPACKED_SIZE / MB} МБ — такой архив не импортируется`);
  }

  if (buffer.length > MAX_ARCHIVE_SIZE) {
    return fail(`Архив получился больше ${MAX_ARCHIVE_SIZE / MB} МБ — такой архив не импортируется`);
  }

  return {
    ok: true,
    buffer,
    manifest,
    filename: asciiFileName(course.title),
    downloadName: downloadFileName(course.title),
    stats: { blocks: blocks.length, files: manifestFiles.length, size: buffer.length },
  };
}
