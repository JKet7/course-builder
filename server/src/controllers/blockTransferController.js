/**
 * Перенос одного блока: экспорт в JSON, дублирование и импорт (JSON или ZIP).
 *
 * Формат файла блока — тот же манифест, что лежит в `course.json` архива курса
 * (Шаг 14), поэтому файл блока понимает и импорт курса. Проверка импорта идёт
 * через валидаторы архива (`readBlockManifest` → `normalizeBlock`), а запись —
 * через `createBlockRecord`; картинки не копируются: ссылки `/uploads/...`
 * указывают на этот же сервер, поэтому несуществующие файлы отсекаются.
 */
import AdmZip from 'adm-zip';
import multer from 'multer';
import prisma from '../config/prisma.js';
import { ARCHIVE_FORMAT, ARCHIVE_VERSION, readBlockManifest } from '../utils/courseArchive.js';
import { COURSE_EXPORT_SELECT, buildBlockManifest } from '../utils/courseExport.js';
import { getNextOrder } from '../utils/order.js';
import { createBlockRecord } from './courseImportController.js';
import { BLOCK_SELECT, toBlock } from './blockController.js';

/** Ограничение размера файла блока: JSON или ZIP с одним блоком. */
export const BLOCK_FILE_MAX_SIZE = 10 * 1024 * 1024;

const BLOCK_FILE_MAX_MB = BLOCK_FILE_MAX_SIZE / (1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BLOCK_FILE_MAX_SIZE, files: 1 },
});

/** ZIP всегда начинается с сигнатуры «PK». */
const isZip = (buffer) => buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b;

/**
 * Экспорт не копирует картинки: заглушка сообщает buildBlockManifest,
 * что файл уже лежит на сервере и ссылку нужно оставить как есть.
 */
const keepImages = (data) => (data ? { file: null, data } : null);

/** course.json из ZIP-архива блока (в корне или в единственной папке). */
function manifestFromZip(buffer) {
  let zip;

  try {
    zip = new AdmZip(buffer);
  } catch {
    return { ok: false, message: 'Не удалось прочитать ZIP-архив' };
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const direct = entries.find((entry) => entry.entryName === 'course.json');
  const nested = entries.filter((entry) => entry.entryName.endsWith('/course.json'));
  const entry = direct ?? (nested.length === 1 ? nested[0] : null);

  if (!entry) return { ok: false, message: 'В архиве нет course.json' };

  try {
    return { ok: true, data: JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/, '')) };
  } catch {
    return { ok: false, message: 'course.json — некорректный JSON' };
  }
}

/**
 * Блок из содержимого файла: наш файл блока ({ kind: 'block', block }),
 * манифест архива с единственным блоком или сам блок без обёртки.
 */
function pickBlock(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.block && typeof data.block === 'object' && !Array.isArray(data.block)) return data.block;
  if (Array.isArray(data.blocks)) return data.blocks.length === 1 ? data.blocks[0] : null;
  if (typeof data.type === 'string') return data;
  return null;
}

/** Ссылки на картинки в блоке: id файлов и пути /uploads/... */
function collectFileRefs(block) {
  const ids = new Set();
  const paths = new Set();

  const addPath = (value) => {
    if (typeof value === 'string' && value.startsWith('/uploads/')) paths.add(value);
  };

  addPath(block?.coverImage);

  for (const slide of Array.isArray(block?.slides) ? block.slides : []) {
    for (const item of Array.isArray(slide?.contents) ? slide.contents : []) {
      if (item?.type !== 'image' || !item.data) continue;
      if (typeof item.data.fileId === 'string' && item.data.fileId) ids.add(item.data.fileId);
      addPath(item.data.url);
    }
  }

  // Изображения сторон карточек теста
  for (const question of Array.isArray(block?.questions) ? block.questions : []) {
    if (question?.type !== 'card') continue;
    addPath(question.data?.frontImage);
    addPath(question.data?.backImage);
  }

  return { ids, paths };
}

/** Ключи файлов, которые уже есть в базе: по ним валидатор проверяет картинки. */
async function knownFileKeys(block) {
  const { ids, paths } = collectFileRefs(block);
  const keys = new Set();

  if (ids.size === 0 && paths.size === 0) return keys;

  const where = [];
  if (ids.size > 0) where.push({ id: { in: [...ids] } });
  if (paths.size > 0) where.push({ path: { in: [...paths] } });

  const files = await prisma.file.findMany({ where: { OR: where }, select: { id: true, path: true } });

  for (const file of files) {
    keys.add(file.id);
    keys.add(file.path);
  }

  return keys;
}

/** Приём файла блока (поле `file`) с понятными ошибками валидации. */
export function uploadBlockFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: `Файл блока больше ${BLOCK_FILE_MAX_MB} МБ` });
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: `Ошибка загрузки: ${error.message}` });
    }

    return next(error);
  });
}

/** GET /api/blocks/:id/export — JSON-манифест блока для скачивания. */
export async function exportBlock(req, res) {
  const block = await prisma.block.findUnique({
    where: { id: req.params.id },
    select: {
      ...COURSE_EXPORT_SELECT.blocks.select,
      course: { select: { id: true, title: true } },
    },
  });

  if (!block) return res.status(404).json({ message: 'Блок не найден' });

  return res.json({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    kind: 'block',
    exportedAt: new Date().toISOString(),
    course: { id: block.course.id, title: block.course.title },
    block: buildBlockManifest(block, keepImages),
  });
}

/** POST /api/blocks/:id/duplicate — копия блока в конце списка его курса. */
export async function duplicateBlock(req, res) {
  const block = await prisma.block.findUnique({
    where: { id: req.params.id },
    select: { ...COURSE_EXPORT_SELECT.blocks.select, courseId: true },
  });

  if (!block) return res.status(404).json({ message: 'Блок не найден' });

  const manifest = buildBlockManifest(block, keepImages);
  manifest.title = `${manifest.title} (копия)`.slice(0, 200);

  const order = await getNextOrder(prisma.block, { courseId: block.courseId });

  const created = await prisma.$transaction(
    (tx) => createBlockRecord(tx, block.courseId, manifest, order, new Map()),
    { maxWait: 5000, timeout: 30000 },
  );

  const fresh = await prisma.block.findUnique({ where: { id: created.id }, select: BLOCK_SELECT });

  res.locals.audit = { entityId: created.id };
  return res.status(201).json({ block: toBlock(fresh) });
}

/** POST /api/blocks/import?courseId= — блок из JSON-манифеста или ZIP-файла. */
export async function importBlock(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Файл не передан (ожидается поле file)' });
  }

  const courseId = String(req.body?.courseId ?? req.query.courseId ?? '').trim();
  if (!courseId) return res.status(400).json({ message: 'Не указан курс для импорта' });

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  let data;

  if (isZip(req.file.buffer)) {
    const parsed = manifestFromZip(req.file.buffer);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });
    data = parsed.data;
  } else {
    try {
      data = JSON.parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      return res.status(400).json({ message: 'Файл блока — некорректный JSON' });
    }
  }

  const rawBlock = pickBlock(data);
  if (!rawBlock) {
    return res.status(400).json({
      message: 'В файле нет блока: ожидается файл блока или архив с одним блоком',
    });
  }

  const knownFiles = await knownFileKeys(rawBlock);
  const parsed = readBlockManifest(rawBlock, knownFiles);

  if (!parsed.ok) return res.status(400).json({ message: parsed.message });

  const order = await getNextOrder(prisma.block, { courseId });

  const created = await prisma.$transaction(
    (tx) => createBlockRecord(tx, courseId, parsed.block, order, new Map()),
    { maxWait: 5000, timeout: 30000 },
  );

  const fresh = await prisma.block.findUnique({ where: { id: created.id }, select: BLOCK_SELECT });

  res.locals.audit = { entityId: created.id };
  return res.status(201).json({ block: toBlock(fresh) });
}
