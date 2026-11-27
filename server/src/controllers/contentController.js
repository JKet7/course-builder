import prisma from '../config/prisma.js';
import {
  CONTENT_SELECT,
  CONTENT_TYPES,
  CONTENT_WIDTHS,
  CURRENT_DATA_VERSION,
  normalizeContentData,
} from '../utils/content.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';

const THEORY_ONLY = 'Контент доступен только в блоке «Теория»';

const notFound = (res, message = 'Фрагмент контента не найден') => res.status(404).json({ message });

/** Слайд + проверка, что его блок — «Теория». */
async function loadSlide(res, slideId) {
  if (!slideId) {
    res.status(400).json({ message: 'Параметр slideId обязателен' });
    return null;
  }

  const slide = await prisma.theorySlide.findUnique({
    where: { id: slideId },
    select: { id: true, blockId: true, block: { select: { type: true } } },
  });

  if (!slide) {
    res.status(404).json({ message: 'Слайд не найден' });
    return null;
  }

  if (slide.block.type !== 'theory') {
    res.status(400).json({ message: THEORY_ONLY });
    return null;
  }

  return slide;
}

/** GET /api/contents?slideId= — контент слайда по order (с dataVersion) */
export async function listContents(req, res) {
  const slideId = String(req.query.slideId ?? '').trim();
  const slide = await loadSlide(res, slideId);
  if (!slide) return undefined;

  const contents = await prisma.theoryContent.findMany({
    where: { slideId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: CONTENT_SELECT,
  });

  return res.json({ contents, dataVersion: CURRENT_DATA_VERSION });
}

/** GET /api/contents/:id */
export async function getContent(req, res) {
  const content = await prisma.theoryContent.findUnique({
    where: { id: req.params.id },
    select: { ...CONTENT_SELECT, slide: { select: { block: { select: { type: true } } } } },
  });

  if (!content) return notFound(res);
  if (content.slide.block.type !== 'theory') return res.status(400).json({ message: THEORY_ONLY });

  const { slide, ...rest } = content;
  return res.json({ content: rest });
}


/** POST /api/contents — dataVersion ставит сервер, клиент его не присылает */
export async function createContent(req, res) {
  const { slideId, type, data, width } = req.body;

  if (!CONTENT_TYPES.includes(type)) {
    return res.status(400).json({
      message: 'Ошибка валидации',
      errors: { type: `Тип: допустимые значения — ${CONTENT_TYPES.join(', ')}` },
    });
  }

  const slide = await loadSlide(res, slideId);
  if (!slide) return undefined;

  if (width !== undefined && !CONTENT_WIDTHS.includes(width)) {
    return res.status(400).json({
      message: 'Ошибка валидации',
      errors: { width: `Ширина: допустимые значения — ${CONTENT_WIDTHS.join(', ')}` },
    });
  }

  if (req.body.dataVersion !== undefined) {
    return res.status(400).json({ message: 'dataVersion задаётся сервером' });
  }

  const normalized = normalizeContentData(type, data);
  if (!normalized.ok) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { data: normalized.message } });
  }

  const order = await getNextOrder(prisma.theoryContent, { slideId });

  const content = await prisma.theoryContent.create({
    data: {
      slideId,
      type,
      data: normalized.data,
      dataVersion: CURRENT_DATA_VERSION,
      width: width ?? 100,
      order,
    },
    select: CONTENT_SELECT,
  });

  res.locals.audit = { entityId: content.id };
  return res.status(201).json({ content });
}

/** PUT /api/contents/:id — data (для не-текста мержим с текущей), width */
export async function updateContent(req, res) {
  const existing = await prisma.theoryContent.findUnique({
    where: { id: req.params.id },
    select: { id: true, type: true, data: true, slide: { select: { block: { select: { type: true } } } } },
  });

  if (!existing) return notFound(res);
  if (existing.slide.block.type !== 'theory') return res.status(400).json({ message: THEORY_ONLY });

  if (req.body.dataVersion !== undefined) {
    return res.status(400).json({ message: 'dataVersion задаётся сервером' });
  }

  const patch = {};

  if (req.body.data !== undefined) {
    const isTiptap = existing.type === 'text' || existing.type === 'important';
    const base = isTiptap ? undefined : existing.data ?? {};

    const normalized = normalizeContentData(
      existing.type,
      base ? { ...base, ...(req.body.data ?? {}) } : req.body.data,
    );

    if (!normalized.ok) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { data: normalized.message } });
    }

    patch.data = normalized.data;
  }

  if (req.body.width !== undefined) {
    if (!CONTENT_WIDTHS.includes(req.body.width)) {
      return res.status(400).json({
        message: 'Ошибка валидации',
        errors: { width: `Ширина: допустимые значения — ${CONTENT_WIDTHS.join(', ')}` },
      });
    }
    patch.width = req.body.width;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  const content = await prisma.theoryContent.update({
    where: { id: req.params.id },
    data: patch,
    select: CONTENT_SELECT,
  });

  res.locals.audit = { entityId: content.id };
  return res.json({ content });
}

/** DELETE /api/contents/:id — комментарии удаляются каскадом */
export async function deleteContent(req, res) {
  try {
    await prisma.theoryContent.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/contents/reorder  body: { slideId, orderedIds } */
export async function reorderContents(req, res) {
  const { slideId, orderedIds } = req.body;
  const slide = await loadSlide(res, slideId);
  if (!slide) return undefined;

  const contents = await prisma.theoryContent.findMany({ where: { slideId }, select: { id: true } });
  const knownIds = new Set(contents.map((content) => content.id));
  const unknownIds = orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Контент не принадлежит этому слайду', unknownIds });
  }

  const orderError = validateOrder(orderedIds, knownIds, 'элементов контента');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.theoryContent, orderedIds);

  const updated = await prisma.theoryContent.findMany({
    where: { slideId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: CONTENT_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ contents: updated });
}

