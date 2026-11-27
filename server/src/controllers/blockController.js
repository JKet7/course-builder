import prisma from '../config/prisma.js';
import { BLOCK_TYPES } from '../utils/blocks.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';

// Типы блоков объявлены в utils/blocks.js — список нужен и импорту архива (Шаг 13).
export { BLOCK_TYPES };

/** Поля блока для списков и карточек (используются и в переносе блоков). */
export const BLOCK_SELECT = {
  id: true,
  courseId: true,
  course: { select: { id: true, title: true } },
  type: true,
  title: true,
  description: true,
  coverImage: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { slides: true, groups: true, questions: true, memoSlides: true, memoCells: true, terms: true } },
};

// Что считаем «содержимым» блока для счётчика на карточке
const CONTENT_COUNT_FIELD = {
  theory: 'slides',
  test: 'questions',
  memo: 'memoSlides',
  glossary: 'terms',
};

/** Блок API: счётчики содержимого + contentCount для карточки. */
export const toBlock = (block) => {
  const { _count, ...rest } = block;
  const counts = {
    slides: _count?.slides ?? 0,
    groups: _count?.groups ?? 0,
    questions: _count?.questions ?? 0,
    memoSlides: _count?.memoSlides ?? 0,
    memoCells: _count?.memoCells ?? 0,
    terms: _count?.terms ?? 0,
  };

  return { ...rest, counts, contentCount: counts[CONTENT_COUNT_FIELD[rest.type]] ?? 0 };
};

const notFound = (res, message = 'Блок не найден') => res.status(404).json({ message });

const findCourse = (courseId) =>
  prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });

/** GET /api/blocks?courseId= — блоки курса в порядке сортировки */
export async function listBlocks(req, res) {
  const courseId = String(req.query.courseId ?? '').trim();

  if (!courseId) {
    return res.status(400).json({ message: 'Параметр courseId обязателен' });
  }

  const course = await findCourse(courseId);
  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  const blocks = await prisma.block.findMany({
    where: { courseId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: BLOCK_SELECT,
  });

  return res.json({ blocks: blocks.map(toBlock) });
}

/** GET /api/blocks/:id */
export async function getBlock(req, res) {
  const block = await prisma.block.findUnique({ where: { id: req.params.id }, select: BLOCK_SELECT });

  if (!block) return notFound(res);

  return res.json({ block: toBlock(block) });
}

/** POST /api/blocks — блок добавляется в конец курса */
export async function createBlock(req, res) {
  const { courseId, type, title, description, coverImage } = req.body;

  const course = await findCourse(courseId);
  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  const order = await getNextOrder(prisma.block, { courseId });

  const block = await prisma.block.create({
    data: {
      courseId,
      type,
      title,
      description: description || null,
      coverImage: coverImage || null,
      order,
    },
    select: BLOCK_SELECT,
  });

  res.locals.audit = { entityId: block.id };
  return res.status(201).json({ block: toBlock(block) });
}

/** PUT /api/blocks/:id — тип можно менять, только пока блок пустой */
export async function updateBlock(req, res) {
  const existing = await prisma.block.findUnique({
    where: { id: req.params.id },
    select: { id: true, type: true, _count: BLOCK_SELECT._count },
  });

  if (!existing) return notFound(res);

  const data = {};

  if (typeof req.body.type === 'string' && req.body.type !== existing.type) {
    const hasContent = Object.values(existing._count ?? {}).some((count) => count > 0);

    if (hasContent) {
      return res.status(400).json({
        message: 'Тип блока нельзя изменить: внутри уже есть контент',
        errors: { type: 'Тип блока нельзя изменить, пока внутри есть контент' },
      });
    }

    data.type = req.body.type;
  }

  if (typeof req.body.title === 'string') data.title = req.body.title;

  if (req.body.description !== undefined) {
    const value = typeof req.body.description === 'string' ? req.body.description.trim() : req.body.description;
    data.description = value === '' || value === null || value === undefined ? null : value;
  }

  if (req.body.coverImage !== undefined) {
    const value = typeof req.body.coverImage === 'string' ? req.body.coverImage.trim() : req.body.coverImage;
    data.coverImage = value === '' || value === null || value === undefined ? null : value;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  try {
    const block = await prisma.block.update({
      where: { id: req.params.id },
      data,
      select: BLOCK_SELECT,
    });

    res.locals.audit = { entityId: block.id };
    return res.json({ block: toBlock(block) });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }
}

/** DELETE /api/blocks/:id — контент блока удаляется каскадом */
export async function deleteBlock(req, res) {
  try {
    await prisma.block.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/blocks/reorder  body: { courseId, orderedIds } */
export async function reorderBlocks(req, res) {
  const { courseId, orderedIds } = req.body;

  const course = await findCourse(courseId);
  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  const blocks = await prisma.block.findMany({ where: { courseId }, select: { id: true } });
  const courseIds = new Set(blocks.map((block) => block.id));
  const unknownIds = orderedIds.filter((id) => !courseIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Блоки не принадлежат этому курсу', unknownIds });
  }

  const orderError = validateOrder(orderedIds, courseIds, 'блоков');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.block, orderedIds);

  const updated = await prisma.block.findMany({
    where: { courseId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: BLOCK_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ blocks: updated.map(toBlock) });
}
