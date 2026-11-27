import prisma from '../config/prisma.js';
import { BLOCK_LIMITS, loadBlockOfType, textField } from '../utils/blocks.js';
import { normalizeContentBody } from '../utils/contentBody.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';
import { docToText, normalizeDoc } from '../utils/tiptap.js';

const CELL_SELECT = {
  id: true,
  blockId: true,
  slideId: true,
  title: true,
  titleDoc: true,
  body: true,
  order: true,
};

/** Слайд вместе с карточками: форма, которую сразу рендерит клиент. */
const SLIDE_SELECT = {
  id: true,
  blockId: true,
  title: true,
  order: true,
  cells: {
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: CELL_SELECT,
  },
};

const DEFAULT_SLIDE_TITLE = 'Новый слайд';
const DEFAULT_CELL_TITLE = 'Новая карточка';

const notFoundSlide = (res) => res.status(404).json({ message: 'Слайд памятки не найден' });
const notFoundCell = (res) => res.status(404).json({ message: 'Карточка памятки не найдена' });

/** Слайды блока по порядку — с карточками внутри. */
const loadSlides = (blockId) =>
  prisma.memoSlide.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: SLIDE_SELECT,
  });

/** GET /api/memo-slides?blockId= — слайды памятки с карточками */
export async function listSlides(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'memo');
  if (!block) return undefined;

  return res.json({ slides: await loadSlides(block.id) });
}

/** POST /api/memo-slides  body: { blockId, title? } */
export async function createSlide(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'memo');
  if (!block) return undefined;

  const title = textField(req.body.title, BLOCK_LIMITS.memoTitle) || DEFAULT_SLIDE_TITLE;
  const order = await getNextOrder(prisma.memoSlide, { blockId: block.id });
  const empty = normalizeContentBody(undefined);

  const slide = await prisma.memoSlide.create({
    data: {
      blockId: block.id,
      title,
      order,
      cells: {
        create: {
          blockId: block.id,
          title: DEFAULT_CELL_TITLE,
          body: empty.body,
          order: 0,
        },
      },
    },
    select: SLIDE_SELECT,
  });

  res.locals.audit = { entityId: slide.id };
  return res.status(201).json({ slide });
}

/** PUT /api/memo-slides/:id  body: { title } */
export async function updateSlide(req, res) {
  const title = textField(req.body.title, BLOCK_LIMITS.memoTitle);

  if (!title) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { title: 'Заголовок: обязательное поле' } });
  }

  try {
    const slide = await prisma.memoSlide.update({
      where: { id: req.params.id },
      data: { title },
      select: SLIDE_SELECT,
    });

    res.locals.audit = { entityId: slide.id };
    return res.json({ slide });
  } catch (error) {
    if (error.code === 'P2025') return notFoundSlide(res);
    throw error;
  }
}

/** DELETE /api/memo-slides/:id — карточки удаляются вместе со слайдом */
export async function deleteSlide(req, res) {
  try {
    await prisma.memoSlide.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFoundSlide(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/memo-slides/reorder  body: { blockId, orderedIds } */
export async function reorderSlides(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'memo');
  if (!block) return undefined;

  const slides = await prisma.memoSlide.findMany({ where: { blockId: block.id }, select: { id: true } });
  const knownIds = new Set(slides.map((slide) => slide.id));
  const unknownIds = req.body.orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Слайды не принадлежат этому блоку', unknownIds });
  }

  const orderError = validateOrder(req.body.orderedIds, knownIds, 'слайдов');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.memoSlide, req.body.orderedIds);

  res.locals.audit = { entityId: null };
  return res.json({ slides: await loadSlides(block.id) });
}

/** GET /api/memo-cells?blockId= — плоский список карточек (обратная совместимость) */
export async function listCells(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'memo');
  if (!block) return undefined;

  const cells = await prisma.memoCell.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: CELL_SELECT,
  });

  return res.json({ cells });
}

/** Находит слайд блока по id либо отправляет 404. */
async function findSlideOfBlock(res, slideId, blockId) {
  const slide = await prisma.memoSlide.findFirst({
    where: { id: slideId, blockId },
    select: { id: true },
  });

  if (!slide) {
    notFoundSlide(res);
    return null;
  }

  return slide;
}

/**
 * POST /api/memo-cells  body: { blockId, slideId?, title?, body? }
 * Без slideId карточка попадает в первый слайд; если слайдов ещё нет — слайд
 * создаётся автоматически, чтобы старый вызов из одного поля продолжал работать.
 */
export async function createCell(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'memo');
  if (!block) return undefined;

  const body = normalizeContentBody(req.body.body);
  if (!body.ok) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { body: `Текст: ${body.message}` } });
  }

  // Заголовок карточки — обычное форматированное поле: titleDoc хранит Tiptap JSON,
  // title — его простой текст для поиска и старых клиентов.
  let title = textField(req.body.title, BLOCK_LIMITS.memoTitle) || DEFAULT_CELL_TITLE;
  let titleDoc = null;

  if (req.body.titleDoc !== undefined && req.body.titleDoc !== null) {
    const parsed = normalizeDoc(req.body.titleDoc);
    if (!parsed.ok) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { title: `Заголовок: ${parsed.message}` } });
    }

    const plain = docToText(parsed.doc).slice(0, BLOCK_LIMITS.memoTitle);
    if (!plain) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { title: 'Заголовок: обязательное поле' } });
    }

    title = plain;
    titleDoc = parsed.doc;
  }

  let slideId = textField(req.body.slideId);

  if (slideId) {
    const slide = await findSlideOfBlock(res, slideId, block.id);
    if (!slide) return undefined;
  } else {
    const first = await prisma.memoSlide.findFirst({
      where: { blockId: block.id },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    if (first) {
      slideId = first.id;
    } else {
      const order = await getNextOrder(prisma.memoSlide, { blockId: block.id });
      const created = await prisma.memoSlide.create({
        data: { blockId: block.id, title: 'Слайд 1', order },
        select: { id: true },
      });
      slideId = created.id;
    }
  }

  const order = await getNextOrder(prisma.memoCell, { slideId });

  const cell = await prisma.memoCell.create({
    data: {
      blockId: block.id,
      slideId,
      title,
      titleDoc,
      body: body.body,
      order,
    },
    select: CELL_SELECT,
  });

  res.locals.audit = { entityId: cell.id };
  return res.status(201).json({ cell });
}

/** PUT /api/memo-cells/:id  body: { title?, body?, slideId? } */
export async function updateCell(req, res) {
  const data = {};

  if (req.body.titleDoc !== undefined && req.body.titleDoc !== null) {
    // Форматированный заголовок важнее обычного title: простой текст выводим
    // из документа, чтобы поиск и подсказки всегда видели одно и то же.
    const parsed = normalizeDoc(req.body.titleDoc);
    if (!parsed.ok) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { title: `Заголовок: ${parsed.message}` } });
    }

    const title = docToText(parsed.doc).slice(0, BLOCK_LIMITS.memoTitle);
    if (!title) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { title: 'Заголовок: обязательное поле' } });
    }

    data.title = title;
    data.titleDoc = parsed.doc;
  } else if (req.body.title !== undefined) {
    const title = textField(req.body.title, BLOCK_LIMITS.memoTitle);
    if (!title) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { title: 'Заголовок: обязательное поле' } });
    }

    data.title = title;
    // Клиент без titleDoc присылает только текст — старый форматированный
    // заголовок больше не должен перекрывать новое значение.
    data.titleDoc = null;
  }

  if (req.body.body !== undefined) {
    const body = normalizeContentBody(req.body.body);
    if (!body.ok) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { body: `Текст: ${body.message}` } });
    }
    data.body = body.body;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  const cell = await prisma.memoCell.findUnique({
    where: { id: req.params.id },
    select: { id: true, blockId: true },
  });

  if (!cell) return notFoundCell(res);

  if (req.body.slideId !== undefined) {
    const slideId = textField(req.body.slideId);
    if (!slideId) {
      return res.status(400).json({ message: 'Ошибка валидации', errors: { slideId: 'Слайд: обязательное поле' } });
    }

    const slide = await findSlideOfBlock(res, slideId, cell.blockId);
    if (!slide) return undefined;
    data.slideId = slideId;
  }

  try {
    const updated = await prisma.memoCell.update({
      where: { id: cell.id },
      data,
      select: CELL_SELECT,
    });

    res.locals.audit = { entityId: updated.id };
    return res.json({ cell: updated });
  } catch (error) {
    if (error.code === 'P2025') return notFoundCell(res);
    throw error;
  }
}

/** DELETE /api/memo-cells/:id */
export async function deleteCell(req, res) {
  try {
    await prisma.memoCell.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFoundCell(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/memo-cells/reorder  body: { blockId, slideId?, orderedIds } */
export async function reorderCells(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'memo');
  if (!block) return undefined;

  const slideId = textField(req.body.slideId);

  if (slideId) {
    const slide = await findSlideOfBlock(res, slideId, block.id);
    if (!slide) return undefined;
  }

  const where = slideId ? { blockId: block.id, slideId } : { blockId: block.id };
  const cells = await prisma.memoCell.findMany({ where, select: { id: true } });
  const knownIds = new Set(cells.map((cell) => cell.id));
  const unknownIds = req.body.orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({
      message: slideId ? 'Карточки не принадлежат этому слайду' : 'Карточки не принадлежат этому блоку',
      unknownIds,
    });
  }

  const orderError = validateOrder(req.body.orderedIds, knownIds, 'карточек');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.memoCell, req.body.orderedIds);

  const updated = await prisma.memoCell.findMany({
    where,
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: CELL_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ cells: updated });
}
