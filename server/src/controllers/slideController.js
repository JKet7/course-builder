import prisma from '../config/prisma.js';
import { CONTENT_SELECT } from '../utils/content.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';

/** Слайды живут только внутри блока «Теория» (проверка типа блока). */
export const THEORY_ONLY = 'Слайды доступны только в блоке «Теория»';

const SLIDE_SELECT = {
  id: true,
  blockId: true,
  title: true,
  order: true,
  contents: { orderBy: { order: 'asc' }, select: CONTENT_SELECT },
  _count: { select: { contents: true } },
};

const toSlide = (slide) => {
  const { _count, ...rest } = slide;
  return { ...rest, contentCount: _count?.contents ?? rest.contents?.length ?? 0 };
};

const notFound = (res, message = 'Слайд не найден') => res.status(404).json({ message });

/**
 * Находит блок и проверяет, что он теоретический.
 * При ошибке сам отправляет ответ и возвращает null.
 */
async function loadTheoryBlock(res, blockId) {
  if (!blockId) {
    res.status(400).json({ message: 'Параметр blockId обязателен' });
    return null;
  }

  const block = await prisma.block.findUnique({
    where: { id: blockId },
    select: { id: true, type: true, courseId: true },
  });

  if (!block) {
    res.status(404).json({ message: 'Блок не найден' });
    return null;
  }

  if (block.type !== 'theory') {
    res.status(400).json({ message: THEORY_ONLY });
    return null;
  }

  return block;
}

/** GET /api/slides?blockId= — слайды блока вместе с их контентом */
export async function listSlides(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadTheoryBlock(res, blockId);
  if (!block) return undefined;

  const slides = await prisma.theorySlide.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: SLIDE_SELECT,
  });

  return res.json({ slides: slides.map(toSlide) });
}

/** GET /api/slides/:id */
export async function getSlide(req, res) {
  const slide = await prisma.theorySlide.findUnique({
    where: { id: req.params.id },
    select: { ...SLIDE_SELECT, block: { select: { id: true, type: true, courseId: true } } },
  });

  if (!slide) return notFound(res);
  if (slide.block.type !== 'theory') return res.status(400).json({ message: THEORY_ONLY });

  return res.json({ slide: toSlide(slide) });
}

/** POST /api/slides — слайд добавляется в конец блока */
export async function createSlide(req, res) {
  const { blockId, title } = req.body;
  const block = await loadTheoryBlock(res, blockId);
  if (!block) return undefined;

  const order = await getNextOrder(prisma.theorySlide, { blockId });

  const slide = await prisma.theorySlide.create({
    data: { blockId, title: title || null, order },
    select: SLIDE_SELECT,
  });

  res.locals.audit = { entityId: slide.id };
  return res.status(201).json({ slide: toSlide(slide) });
}

/** PUT /api/slides/:id — пока меняется только название */
export async function updateSlide(req, res) {
  const existing = await prisma.theorySlide.findUnique({
    where: { id: req.params.id },
    select: { id: true, block: { select: { type: true } } },
  });

  if (!existing) return notFound(res);
  if (existing.block.type !== 'theory') return res.status(400).json({ message: THEORY_ONLY });

  if (req.body.title === undefined) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;
  const slide = await prisma.theorySlide.update({
    where: { id: req.params.id },
    data: { title: title === '' ? null : title },
    select: SLIDE_SELECT,
  });

  res.locals.audit = { entityId: slide.id };
  return res.json({ slide: toSlide(slide) });
}

/** DELETE /api/slides/:id — контент слайда удаляется каскадом */
export async function deleteSlide(req, res) {
  try {
    await prisma.theorySlide.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/slides/reorder  body: { blockId, orderedIds } */
export async function reorderSlides(req, res) {
  const { blockId, orderedIds } = req.body;
  const block = await loadTheoryBlock(res, blockId);
  if (!block) return undefined;

  const slides = await prisma.theorySlide.findMany({ where: { blockId }, select: { id: true } });
  const knownIds = new Set(slides.map((slide) => slide.id));
  const unknownIds = orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Слайды не принадлежат этому блоку', unknownIds });
  }

  const orderError = validateOrder(orderedIds, knownIds, 'слайдов');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.theorySlide, orderedIds);

  const updated = await prisma.theorySlide.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: SLIDE_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ slides: updated.map(toSlide) });
}

