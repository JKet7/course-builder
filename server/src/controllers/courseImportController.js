/**
 * Импорт курса из ZIP-архива (Шаг 13).
 *
 * Порядок (алгоритм 2.14):
 * 1. multer принимает архив в память (на диск ничего не пишем);
 * 2. `readCourseArchive` проверяет и нормализует весь архив;
 * 3. картинки сохраняются на диск под новыми именами;
 * 4. курс, блоки и содержимое создаются одной транзакцией, ссылки на файлы
 *    (`fileId` и `/uploads/...`) заменяются на новые;
 * 5. при любой ошибке транзакция откатывается, а записанные файлы удаляются.
 */
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import prisma from '../config/prisma.js';
import { MAX_ARCHIVE_SIZE, readCourseArchive } from '../utils/courseArchive.js';
import { CURRENT_DATA_VERSION } from '../utils/content.js';
import { getNextOrder } from '../utils/order.js';
import {
  IMAGE_MIME_EXT,
  UPLOADS_DIR,
  ensureUploadsDir,
  publicFileUrl,
  removeUploadedFile,
  uniqueUploadFilename,
} from '../utils/uploads.js';

const MAX_ARCHIVE_MB = MAX_ARCHIVE_SIZE / (1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVE_SIZE, files: 1 },
});

const COURSE_SELECT = {
  id: true,
  title: true,
  description: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { blocks: true } },
};

const toCourse = (course) => {
  const { _count, ...rest } = course;
  return { ...rest, blocksCount: _count?.blocks ?? 0 };
};

/** Приём ZIP-архива (поле `file`) с понятными ошибками валидации. */
export function uploadCourseArchive(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: `Архив больше ${MAX_ARCHIVE_MB} МБ` });
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: `Ошибка загрузки: ${error.message}` });
    }

    return next(error);
  });
}

/** Ссылка на картинку → новые id и адрес (по старому fileId или старому url). */
function remapImageData(data, fileIds) {
  const byId = data?.fileId ? fileIds.get(data.fileId) : null;
  const byUrl = !byId && typeof data?.url === 'string' ? fileIds.get(data.url) : null;
  const target = byId ?? byUrl;

  return target ? { ...data, fileId: target.id, url: target.path } : data;
}

/** Обложка блока: путь /uploads/... тоже переезжает на новый файл. */
function remapCover(coverImage, fileIds) {
  if (!coverImage) return null;

  const target = fileIds.get(coverImage);
  return target ? target.path : coverImage;
}

const optionsCreate = (options, sectionIds = []) =>
  options.map((option, index) => ({
    text: option.text,
    isCorrect: option.isCorrect,
    order: index,
    targetType: option.targetType ?? 'next',
    targetSectionId:
      option.targetType === 'section' && sectionIds[option.targetIndex] ? sectionIds[option.targetIndex] : null,
  }));

const pairsCreate = (pairs) =>
  pairs.map((pair, index) => ({ left: pair.left, right: pair.right, order: index }));

/**
 * Блок и всё его содержимое; порядок — по индексам массивов из архива.
 * Экспортируется для импорта и дублирования одного блока (blockTransferController).
 */
export async function createBlockRecord(tx, courseId, block, order, fileIds) {
  const created = await tx.block.create({
    data: {
      courseId,
      type: block.type,
      title: block.title,
      description: block.description,
      coverImage: remapCover(block.coverImage, fileIds),
      order,
    },
    select: { id: true },
  });

  if (block.type === 'theory') {
    for (const [slideIndex, slide] of block.slides.entries()) {
      const createdSlide = await tx.theorySlide.create({
        data: { blockId: created.id, title: slide.title, order: slideIndex },
        select: { id: true },
      });

      if (slide.contents.length === 0) continue;

      await tx.theoryContent.createMany({
        data: slide.contents.map((content, index) => ({
          slideId: createdSlide.id,
          type: content.type,
          data: content.type === 'image' ? remapImageData(content.data, fileIds) : content.data,
          dataVersion: CURRENT_DATA_VERSION,
          width: content.width,
          order: index,
        })),
      });
    }
  }

  if (block.type === 'test') {
    const groupIds = [];

    for (const [groupIndex, group] of block.groups.entries()) {
      const createdGroup = await tx.testGroup.create({
        data: { blockId: created.id, name: group.name, order: groupIndex },
        select: { id: true },
      });
      groupIds.push(createdGroup.id);
    }

    const sectionIds = [];

    for (const [sectionIndex, section] of block.sections.entries()) {
      const createdSection = await tx.testSection.create({
        data: {
          blockId: created.id,
          title: section.title,
          result: section.result ?? null,
          order: sectionIndex,
        },
        select: { id: true },
      });
      sectionIds.push(createdSection.id);
    }

    if (block.settings) {
      await tx.testSettings.create({
        data: {
          blockId: created.id,
          shuffleQuestions: Boolean(block.settings.shuffleQuestions),
          shuffleOptions: Boolean(block.settings.shuffleOptions),
          branching: Boolean(block.settings.branching),
          result: block.settings.result ?? null,
        },
      });
    }

    for (const [questionIndex, question] of block.questions.entries()) {
      const data =
        question.type === 'card'
          ? {
              ...question.data,
              ...(question.data.frontImage
                ? { frontImage: remapCover(question.data.frontImage, fileIds) }
                : {}),
              ...(question.data.backImage
                ? { backImage: remapCover(question.data.backImage, fileIds) }
                : {}),
            }
          : question.data;

      await tx.testQuestion.create({
        data: {
          blockId: created.id,
          groupId: question.groupIndex === null ? null : groupIds[question.groupIndex],
          sectionId: question.sectionIndex === null ? null : sectionIds[question.sectionIndex],
          order: questionIndex,
          type: question.type,
          data,
          explanation: question.explanation,
          options:
            question.options.length > 0 ? { create: optionsCreate(question.options, sectionIds) } : undefined,
          pairs: question.pairs.length > 0 ? { create: pairsCreate(question.pairs) } : undefined,
        },
      });
    }
  }

  if (block.type === 'memo' && block.memoSlides.length > 0) {
    for (const [slideIndex, slide] of block.memoSlides.entries()) {
      await tx.memoSlide.create({
        data: {
          blockId: created.id,
          title: slide.title,
          order: slideIndex,
          cells: {
            create: slide.cells.map((cell, cellIndex) => ({
              blockId: created.id,
              title: cell.title,
              titleDoc: cell.titleDoc ?? null,
              body: cell.body,
              order: cellIndex,
            })),
          },
        },
      });
    }
  }

  if (block.type === 'glossary' && block.terms.length > 0) {
    await tx.glossaryTerm.createMany({
      data: block.terms.map((term) => ({ blockId: created.id, term: term.term, definition: term.definition })),
    });
  }

  return created;
}

/** Счётчики для ответа клиенту и подсказки в интерфейсе. */
function collectStats(blocks, files) {
  const stats = {
    blocks: 0,
    slides: 0,
    contents: 0,
    groups: 0,
    sections: 0,
    questions: 0,
    memoSlides: 0,
    memoCells: 0,
    terms: 0,
  };

  for (const block of blocks) {
    stats.blocks += 1;
    stats.slides += block.slides.length;
    stats.contents += block.slides.reduce((sum, slide) => sum + slide.contents.length, 0);
    stats.groups += block.groups.length;
    stats.sections += block.sections.length;
    stats.questions += block.questions.length;
    stats.memoSlides += block.memoSlides.length;
    stats.memoCells += block.memoSlides.reduce((sum, slide) => sum + slide.cells.length, 0);
    stats.terms += block.terms.length;
  }

  return { ...stats, files: files.length };
}


/** POST /api/courses/import — multipart, поле `file` (ZIP) */
export async function importCourse(req, res) {
  const parsed = readCourseArchive(req.file?.buffer);
  if (!parsed.ok) {
    return res.status(400).json({ message: parsed.message, errors: parsed.errors });
  }

  const { course: courseData, blocks, files } = parsed.archive;
  const written = [];

  try {
    ensureUploadsDir();

    // Файлы пишем до транзакции: имена и адреса нужны для замены ссылок.
    const stored = files.map((file) => {
      const filename = uniqueUploadFilename(IMAGE_MIME_EXT[file.mimeType]);
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
      written.push(filename);

      return { ...file, filename, publicPath: publicFileUrl(filename) };
    });

    const order = await getNextOrder(prisma.course);
    const stats = collectStats(blocks, stored);

    const course = await prisma.$transaction(
      async (tx) => {
        const fileIds = new Map();

        for (const file of stored) {
          const record = await tx.file.create({
            data: {
              path: file.publicPath,
              mimeType: file.mimeType,
              size: file.size,
              uploadedBy: req.user?.id ?? null,
            },
            select: { id: true, path: true },
          });

          for (const key of file.keys) fileIds.set(key, record);
        }

        const created = await tx.course.create({
          data: { title: courseData.title, description: courseData.description, order },
          select: { id: true },
        });

        for (const [index, block] of blocks.entries()) {
          await createBlockRecord(tx, created.id, block, index, fileIds);
        }

        return tx.course.findUnique({ where: { id: created.id }, select: COURSE_SELECT });
      },
      { maxWait: 5000, timeout: 30000 },
    );

    res.locals.audit = { entityId: course.id };
    return res.status(201).json({ course: toCourse(course), stats });
  } catch (error) {
    // Транзакция откатилась — убираем уже записанные файлы, чтобы не копить мусор.
    for (const filename of written) removeUploadedFile(filename);
    throw error;
  }
}

