import prisma from '../config/prisma.js';

/**
 * Следующий индекс сортировки для новой сущности.
 * where — доп. фильтр (например, { courseId } для блоков).
 */
export async function getNextOrder(delegate, where = {}) {
  const last = await delegate.findFirst({
    where,
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (last?.order ?? -1) + 1;
}

/**
 * Переставляет элементы по массиву id: order = индекс в массиве.
 * Выполняется в одной транзакции.
 */
export function reorderItems(delegate, orderedIds) {
  return prisma.$transaction(
    orderedIds.map((id, index) => delegate.update({ where: { id }, data: { order: index } })),
  );
}

/**
 * PUT /reorder принимает полный порядок siblings, поэтому список должен
 * содержать все существующие id ровно по одному разу. Возвращает тело
 * ошибки 400 или null.
 */
export function validateOrder(orderedIds, knownIds, label = 'элементов') {
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { message: `Порядок ${label} содержит повторяющиеся id` };
  }

  const missingIds = [...knownIds].filter((id) => !orderedIds.includes(id));

  if (missingIds.length > 0) {
    return { message: `Порядок ${label} неполный — передайте все элементы`, missingIds };
  }

  return null;
}
