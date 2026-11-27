import prisma from '../config/prisma.js';

/**
 * Допустимые типы блоков (SQLite не поддерживает enum, проверяем на уровне API).
 * Живёт здесь, потому что список нужен и контроллеру блоков, и импорту архива.
 */
export const BLOCK_TYPES = ['theory', 'test', 'memo', 'glossary'];

/** Сообщения для блоков «Тест», «Памятка», «Глоссарий» (Шаг 11). */
export const BLOCK_ONLY_MESSAGES = {
  test: 'Доступно только в блоке «Тест»',
  memo: 'Доступно только в блоке «Памятка»',
  glossary: 'Доступно только в блоке «Глоссарий»',
};

/**
 * Проверяет, что блок существует и нужного типа.
 * Возвращает блок либо null — тогда ответ клиенту уже отправлен.
 */
export async function loadBlockOfType(res, blockId, type, message) {
  const id = typeof blockId === 'string' ? blockId.trim() : '';

  if (!id) {
    res.status(400).json({ message: 'Параметр blockId обязателен' });
    return null;
  }

  const block = await prisma.block.findUnique({
    where: { id },
    select: { id: true, type: true, title: true },
  });

  if (!block) {
    res.status(404).json({ message: 'Блок не найден' });
    return null;
  }

  if (block.type !== type) {
    res.status(400).json({ message: message ?? BLOCK_ONLY_MESSAGES[type] ?? 'Недопустимый тип блока' });
    return null;
  }

  return block;
}

/** Ограничения размеров для блоков Шага 11. */
export const BLOCK_LIMITS = {
  groupName: 120,
  term: 200,
  memoTitle: 200,
  importRows: 500,
};

/** Строка из запроса: обрезаем пробелы и ограничиваем длину. */
export const textField = (value, max) => {
  const text = String(value ?? '').trim();
  return max ? text.slice(0, max) : text;
};
