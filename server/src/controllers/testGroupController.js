import prisma from '../config/prisma.js';
import { BLOCK_LIMITS, loadBlockOfType, textField } from '../utils/blocks.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';

const GROUP_SELECT = {
  id: true,
  blockId: true,
  name: true,
  order: true,
  _count: { select: { questions: true } },
};

const toGroup = ({ _count, ...rest }) => ({ ...rest, questionsCount: _count?.questions ?? 0 });

const notFound = (res) => res.status(404).json({ message: 'Группа не найдена' });

/** GET /api/test-groups?blockId= — группы блока «Тест» */
export async function listGroups(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'test');
  if (!block) return undefined;

  const groups = await prisma.testGroup.findMany({
    where: { blockId },
    orderBy: [{ order: 'asc' }],
    select: GROUP_SELECT,
  });

  return res.json({ groups: groups.map(toGroup) });
}

/** POST /api/test-groups  body: { blockId, name } */
export async function createGroup(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const name = textField(req.body.name, BLOCK_LIMITS.groupName) || 'Новая группа';
  const order = await getNextOrder(prisma.testGroup, { blockId: block.id });

  const group = await prisma.testGroup.create({
    data: { blockId: block.id, name, order },
    select: GROUP_SELECT,
  });

  res.locals.audit = { entityId: group.id };
  return res.status(201).json({ group: toGroup(group) });
}

/** PUT /api/test-groups/:id  body: { name } */
export async function updateGroup(req, res) {
  const name = textField(req.body.name, BLOCK_LIMITS.groupName);

  if (!name) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { name: 'Название: обязательное поле' } });
  }

  try {
    const group = await prisma.testGroup.update({
      where: { id: req.params.id },
      data: { name },
      select: GROUP_SELECT,
    });

    res.locals.audit = { entityId: group.id };
    return res.json({ group: toGroup(group) });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }
}

/** DELETE /api/test-groups/:id — вопросы остаются в блоке без группы */
export async function deleteGroup(req, res) {
  try {
    await prisma.testGroup.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/test-groups/reorder  body: { blockId, orderedIds } */
export async function reorderGroups(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'test');
  if (!block) return undefined;

  const groups = await prisma.testGroup.findMany({ where: { blockId: block.id }, select: { id: true } });
  const knownIds = new Set(groups.map((group) => group.id));
  const unknownIds = req.body.orderedIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Группы не принадлежат этому блоку', unknownIds });
  }

  const orderError = validateOrder(req.body.orderedIds, knownIds, 'групп');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.testGroup, req.body.orderedIds);

  const updated = await prisma.testGroup.findMany({
    where: { blockId: block.id },
    orderBy: [{ order: 'asc' }],
    select: GROUP_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ groups: updated.map(toGroup) });
}
