import prisma from '../config/prisma.js';
import { loadBlockOfType } from '../utils/blocks.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';
import {
  QUESTION_SELECT,
  QUESTION_TYPES,
  normalizeQuestion,
  resolveOptionTargets,
} from '../utils/questions.js';

const notFound = (res) => res.status(404).json({ message: 'Вопрос не найден' });

const validationError = (res, message) =>
  res.status(400).json({ message: 'Ошибка валидации', errors: { question: message } });

/** Группа вопроса должна существовать и принадлежать тому же блоку. */
async function resolveGroup(res, blockId, groupId) {
  if (groupId === undefined || groupId === null || groupId === '') {
    return { ok: true, groupId: null };
  }

  const group = await prisma.testGroup.findUnique({
    where: { id: String(groupId) },
    select: { id: true, blockId: true },
  });

  if (!group) {
    res.status(404).json({ message: 'Группа не найдена' });
    return { ok: false };
  }

  if (group.blockId !== blockId) {
    res.status(400).json({ message: 'Группа принадлежит другому блоку' });
    return { ok: false };
  }

  return { ok: true, groupId: group.id };
}

/** Раздел вопроса должен существовать и принадлежать тому же блоку. */
async function resolveSection(res, blockId, sectionId) {
  if (sectionId === undefined || sectionId === null || sectionId === '') {
    return { ok: true, sectionId: null };
  }

  const section = await prisma.testSection.findUnique({
    where: { id: String(sectionId) },
    select: { id: true, blockId: true },
  });

  if (!section) {
    res.status(404).json({ message: 'Раздел не найден' });
    return { ok: false };
  }

  if (section.blockId !== blockId) {
    res.status(400).json({ message: 'Раздел принадлежит другому блоку' });
    return { ok: false };
  }

  return { ok: true, sectionId: section.id };
}

/** Цели перехода вариантов: «в раздел» — только раздел этого блока. */
async function validateTargets(res, blockId, options) {
  if (options.length === 0) return { ok: true, options };

  const sections = await prisma.testSection.findMany({ where: { blockId }, select: { id: true } });
  const result = resolveOptionTargets(options, new Set(sections.map((section) => section.id)));

  if (!result.ok) {
    validationError(res, result.message);
    return { ok: false };
  }

  return result;
}

const optionsCreate = (options) =>
  options.map((option, index) => ({
    text: option.text,
    isCorrect: option.isCorrect,
    order: index,
    targetType: option.targetType ?? 'next',
    targetSectionId: option.targetType === 'section' ? option.targetSectionId ?? null : null,
  }));

const pairsCreate = (pairs) =>
  pairs.map((pair, index) => ({ left: pair.left, right: pair.right, order: index }));

/** Поля вопроса из результата normalizeQuestion → данные Prisma. */
const toQuestionData = (normalized) => ({
  type: normalized.type,
  data: normalized.data,
  explanation: normalized.explanation,
});

const questionRelations = (normalized) => ({
  options: normalized.options.length > 0 ? { create: optionsCreate(normalized.options) } : undefined,
  pairs: normalized.pairs.length > 0 ? { create: pairsCreate(normalized.pairs) } : undefined,
});

/** GET /api/questions?blockId= — вопросы блока «Тест» с вариантами и парами */
export async function listQuestions(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'test');
  if (!block) return undefined;

  const questions = await prisma.testQuestion.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }],
    select: QUESTION_SELECT,
  });

  return res.json({ questions, types: QUESTION_TYPES });
}

/** POST /api/questions  body: { blockId, groupId?, type, data, options?, pairs?, explanation? } */
export async function createQuestion(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const normalized = normalizeQuestion(req.body.type, req.body);
  if (!normalized.ok) return validationError(res, normalized.message);

  const group = await resolveGroup(res, block.id, req.body.groupId);
  if (!group.ok) return undefined;

  const section = await resolveSection(res, block.id, req.body.sectionId);
  if (!section.ok) return undefined;

  const targets = await validateTargets(res, block.id, normalized.options);
  if (!targets.ok) return undefined;

  const prepared = { ...normalized, options: targets.options };
  const order = await getNextOrder(prisma.testQuestion, { blockId: block.id });

  const question = await prisma.testQuestion.create({
    data: {
      blockId: block.id,
      groupId: group.groupId,
      sectionId: section.sectionId,
      order,
      ...toQuestionData(prepared),
      ...questionRelations(prepared),
    },
    select: QUESTION_SELECT,
  });

  res.locals.audit = { entityId: question.id };
  return res.status(201).json({ question });
}

/**
 * PUT /api/questions/:id
 * Варианты и пары приходят целиком: сервер заменяет их в одной транзакции.
 */
export async function updateQuestion(req, res) {
  const existing = await prisma.testQuestion.findUnique({
    where: { id: req.params.id },
    select: QUESTION_SELECT,
  });

  if (!existing) return notFound(res);

  const body = req.body;

  const normalized = normalizeQuestion(body.type ?? existing.type, {
    data: body.data !== undefined ? body.data : existing.data,
    options: body.options !== undefined ? body.options : existing.options,
    pairs: body.pairs !== undefined ? body.pairs : existing.pairs,
    explanation: body.explanation !== undefined ? body.explanation : existing.explanation,
  });

  if (!normalized.ok) return validationError(res, normalized.message);

  let groupId = existing.groupId ?? null;
  if (body.groupId !== undefined) {
    const group = await resolveGroup(res, existing.blockId, body.groupId);
    if (!group.ok) return undefined;
    groupId = group.groupId;
  }

  let sectionId = existing.sectionId ?? null;
  if (body.sectionId !== undefined) {
    const section = await resolveSection(res, existing.blockId, body.sectionId);
    if (!section.ok) return undefined;
    sectionId = section.sectionId;
  }

  const targets = await validateTargets(res, existing.blockId, normalized.options);
  if (!targets.ok) return undefined;

  const prepared = { ...normalized, options: targets.options };

  const question = await prisma.$transaction(async (tx) => {
    await tx.testOption.deleteMany({ where: { questionId: existing.id } });
    await tx.testPair.deleteMany({ where: { questionId: existing.id } });

    return tx.testQuestion.update({
      where: { id: existing.id },
      data: {
        groupId,
        sectionId,
        ...toQuestionData(prepared),
        ...questionRelations(prepared),
      },
      select: QUESTION_SELECT,
    });
  });

  res.locals.audit = { entityId: question.id };
  return res.json({ question });
}

/** DELETE /api/questions/:id — варианты и пары удаляются каскадом */
export async function deleteQuestion(req, res) {
  try {
    await prisma.testQuestion.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** POST /api/questions/:id/duplicate — копия сразу после оригинала */
export async function duplicateQuestion(req, res) {
  const existing = await prisma.testQuestion.findUnique({
    where: { id: req.params.id },
    select: QUESTION_SELECT,
  });

  if (!existing) return notFound(res);

  const question = await prisma.$transaction(async (tx) => {
    // Освобождаем место после оригинала, чтобы копия встала следом.
    await tx.testQuestion.updateMany({
      where: { blockId: existing.blockId, order: { gte: existing.order + 1 } },
      data: { order: { increment: 1 } },
    });

    return tx.testQuestion.create({
      data: {
        blockId: existing.blockId,
        groupId: existing.groupId,
        sectionId: existing.sectionId,
        type: existing.type,
        data: existing.data,
        explanation: existing.explanation,
        order: existing.order + 1,
        options:
          existing.options.length > 0
            ? {
                create: existing.options.map((option, index) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  order: index,
                  targetType: option.targetType,
                  targetSectionId: option.targetSectionId,
                })),
              }
            : undefined,
        pairs:
          existing.pairs.length > 0
            ? {
                create: existing.pairs.map((pair, index) => ({
                  left: pair.left,
                  right: pair.right,
                  order: index,
                })),
              }
            : undefined,
      },
      select: QUESTION_SELECT,
    });
  });

  res.locals.audit = { entityId: question.id };
  return res.status(201).json({ question });
}

/** PUT /api/questions/reorder  body: { blockId, orderedIds } */
export async function reorderQuestions(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const questions = await prisma.testQuestion.findMany({ where: { blockId: block.id }, select: { id: true } });
  const knownIds = new Set(questions.map((question) => question.id));
  const unknownIds = req.body.orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Вопросы не принадлежат этому блоку', unknownIds });
  }

  const orderError = validateOrder(req.body.orderedIds, knownIds, 'вопросов');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.testQuestion, req.body.orderedIds);

  const updated = await prisma.testQuestion.findMany({
    where: { blockId: block.id },
    orderBy: [{ order: 'asc' }],
    select: QUESTION_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ questions: updated });
}
