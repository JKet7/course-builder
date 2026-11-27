import prisma from '../config/prisma.js';
import { loadBlockOfType, textField } from '../utils/blocks.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';
import { DEFAULT_TEST_SETTINGS, QUESTION_LIMITS, SECTION_SELECT } from '../utils/questions.js';
import { normalizeDoc } from '../utils/tiptap.js';

const notFound = (res) => res.status(404).json({ message: 'Раздел не найден' });

const validationError = (res, message) =>
  res.status(400).json({ message: 'Ошибка валидации', errors: { section: message } });

/** _count.questions → questionsCount для клиента. */
const toSection = ({ _count, ...rest }) => ({ ...rest, questionsCount: _count?.questions ?? 0 });

/** Итоговый комментарий раздела — Tiptap-документ или null. */
function readResult(res, value) {
  if (value === undefined) return { ok: true, result: undefined };
  if (value === null) return { ok: true, result: null };

  const parsed = normalizeDoc(value);
  if (!parsed.ok) {
    validationError(res, `Итог раздела: ${parsed.message}`);
    return { ok: false };
  }

  return { ok: true, result: parsed.doc };
}

/** GET /api/test-sections?blockId= — разделы блока «Тест» */
export async function listSections(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'test');
  if (!block) return undefined;

  const sections = await prisma.testSection.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }],
    select: SECTION_SELECT,
  });

  return res.json({ sections: sections.map(toSection) });
}

/** POST /api/test-sections  body: { blockId, title? } */
export async function createSection(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const count = await prisma.testSection.count({ where: { blockId: block.id } });

  if (count >= QUESTION_LIMITS.sections) {
    return validationError(res, `В блоке не может быть больше ${QUESTION_LIMITS.sections} разделов`);
  }

  const title = textField(req.body.title, QUESTION_LIMITS.sectionTitle) || 'Новый раздел';
  const order = await getNextOrder(prisma.testSection, { blockId: block.id });

  const section = await prisma.testSection.create({
    data: { blockId: block.id, title, order },
    select: SECTION_SELECT,
  });

  res.locals.audit = { entityId: section.id };
  return res.status(201).json({ section: toSection(section) });
}

/** PUT /api/test-sections/:id  body: { title?, result? } */
export async function updateSection(req, res) {
  const data = {};

  if (req.body.title !== undefined) {
    const title = textField(req.body.title, QUESTION_LIMITS.sectionTitle);
    if (!title) return validationError(res, 'Название раздела не может быть пустым');
    data.title = title;
  }

  const parsed = readResult(res, req.body.result);
  if (!parsed.ok) return undefined;
  if (parsed.result !== undefined) data.result = parsed.result;

  if (Object.keys(data).length === 0) {
    return validationError(res, 'Нет полей для обновления');
  }

  try {
    const section = await prisma.testSection.update({
      where: { id: req.params.id },
      data,
      select: SECTION_SELECT,
    });

    res.locals.audit = { entityId: section.id };
    return res.json({ section: toSection(section) });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }
}

/**
 * DELETE /api/test-sections/:id
 * Вопросы остаются в блоке без раздела, переходы «в этот раздел» становятся
 * обычным «следующий вопрос» — иначе в логике осталась бы битая ссылка.
 */
export async function deleteSection(req, res) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.testOption.updateMany({
        where: { targetSectionId: req.params.id },
        data: { targetType: 'next', targetSectionId: null },
      });
      await tx.testSection.delete({ where: { id: req.params.id } });
    });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/test-sections/reorder  body: { blockId, orderedIds } */
export async function reorderSections(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const sections = await prisma.testSection.findMany({ where: { blockId: block.id }, select: { id: true } });
  const knownIds = new Set(sections.map((section) => section.id));
  const unknownIds = req.body.orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Разделы не принадлежат этому блоку', unknownIds });
  }

  const orderError = validateOrder(req.body.orderedIds, knownIds, 'разделов');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.testSection, req.body.orderedIds);

  const updated = await prisma.testSection.findMany({
    where: { blockId: block.id },
    orderBy: [{ order: 'asc' }],
    select: SECTION_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ sections: updated.map(toSection) });
}

/** GET /api/test-settings?blockId= — настройки теста (по умолчанию выключены) */
export async function getSettings(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'test');
  if (!block) return undefined;

  const settings = await prisma.testSettings.findUnique({ where: { blockId: block.id } });

  return res.json({
    settings: settings ?? { blockId: block.id, ...DEFAULT_TEST_SETTINGS },
  });
}

/** PUT /api/test-settings  body: { blockId, shuffleQuestions?, shuffleOptions?, branching?, result? } */
export async function updateSettings(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const data = {};

  for (const key of ['shuffleQuestions', 'shuffleOptions', 'branching']) {
    if (req.body[key] !== undefined) data[key] = Boolean(req.body[key]);
  }

  const parsed = readResult(res, req.body.result);
  if (!parsed.ok) return undefined;
  if (parsed.result !== undefined) data.result = parsed.result;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  const settings = await prisma.testSettings.upsert({
    where: { blockId: block.id },
    update: data,
    create: { blockId: block.id, ...DEFAULT_TEST_SETTINGS, ...data },
  });

  res.locals.audit = { entityId: block.id };
  return res.json({ settings });
}
