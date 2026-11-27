import prisma from '../config/prisma.js';
import { BLOCK_LIMITS, loadBlockOfType, textField } from '../utils/blocks.js';
import { normalizeContentBody } from '../utils/contentBody.js';

const TERM_SELECT = {
  id: true,
  blockId: true,
  term: true,
  definition: true,
};

const notFound = (res) => res.status(404).json({ message: 'Термин не найден' });

/**
 * Термин из строки запроса/CSV.
 * Возвращает { ok: true, term, definition } | { ok: false, message }.
 *
 * definition — тело карточки (все типы контента); старое Tiptap-определение
 * принимается и превращается в тело из одного текстового фрагмента.
 */
function normalizeTerm(item) {
  const term = textField(item?.term, BLOCK_LIMITS.term);

  if (!term) return { ok: false, message: 'термин не может быть пустым' };

  const definition = normalizeContentBody(item?.definition);
  if (!definition.ok) return { ok: false, message: `определение: ${definition.message}` };

  return { ok: true, term, definition: definition.body };
}

/** GET /api/terms?blockId= — термины глоссария (сортирует клиент) */
export async function listTerms(req, res) {
  const blockId = String(req.query.blockId ?? '').trim();
  const block = await loadBlockOfType(res, blockId, 'glossary');
  if (!block) return undefined;

  const terms = await prisma.glossaryTerm.findMany({
    where: { blockId },
    orderBy: [{ term: 'asc' }],
    select: TERM_SELECT,
  });

  return res.json({ terms });
}

/** POST /api/terms  body: { blockId, term, definition } */
export async function createTerm(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'glossary');
  if (!block) return undefined;

  const normalized = normalizeTerm(req.body);
  if (!normalized.ok) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { term: normalized.message } });
  }

  const term = await prisma.glossaryTerm.create({
    data: { blockId: block.id, term: normalized.term, definition: normalized.definition },
    select: TERM_SELECT,
  });

  res.locals.audit = { entityId: term.id };
  return res.status(201).json({ term });
}

/**
 * POST /api/terms/bulk  body: { blockId, terms: [{ term, definition }] }
 * Импорт CSV одной транзакцией: либо все строки, либо ни одной.
 */
export async function importTerms(req, res) {
  const block = await loadBlockOfType(res, req.body.blockId, 'glossary');
  if (!block) return undefined;

  const rows = Array.isArray(req.body.terms) ? req.body.terms : [];

  if (rows.length === 0) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { terms: 'Список терминов пуст' } });
  }

  if (rows.length > BLOCK_LIMITS.importRows) {
    return res.status(400).json({
      message: 'Ошибка валидации',
      errors: { terms: `За один раз можно импортировать не более ${BLOCK_LIMITS.importRows} строк` },
    });
  }

  const normalized = [];
  for (const [index, row] of rows.entries()) {
    const result = normalizeTerm(row);
    if (!result.ok) {
      return res.status(400).json({
        message: 'Ошибка валидации',
        errors: { terms: `Строка ${index + 1}: ${result.message}` },
      });
    }
    normalized.push(result);
  }

  const created = await prisma.$transaction(
    normalized.map((item) =>
      prisma.glossaryTerm.create({
        data: { blockId: block.id, term: item.term, definition: item.definition },
        select: TERM_SELECT,
      }),
    ),
  );

  res.locals.audit = { entityId: null };
  return res.status(201).json({ created: created.length, terms: created });
}

/** PUT /api/terms/:id  body: { term?, definition? } */
export async function updateTerm(req, res) {
  const existing = await prisma.glossaryTerm.findUnique({
    where: { id: req.params.id },
    select: TERM_SELECT,
  });

  if (!existing) return notFound(res);

  const normalized = normalizeTerm({
    term: req.body.term !== undefined ? req.body.term : existing.term,
    definition: req.body.definition !== undefined ? req.body.definition : existing.definition,
  });

  if (!normalized.ok) {
    return res.status(400).json({ message: 'Ошибка валидации', errors: { term: normalized.message } });
  }

  const term = await prisma.glossaryTerm.update({
    where: { id: existing.id },
    data: { term: normalized.term, definition: normalized.definition },
    select: TERM_SELECT,
  });

  res.locals.audit = { entityId: term.id };
  return res.json({ term });
}

/** DELETE /api/terms/:id */
export async function deleteTerm(req, res) {
  try {
    await prisma.glossaryTerm.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}
