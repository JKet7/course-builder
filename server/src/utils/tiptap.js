/**
 * Общие правила для полей с Tiptap JSON (MemoCell.body, GlossaryTerm.definition,
 * TestQuestion.explanation). Ввели на Шаге 11, чтобы не дублировать проверки.
 */

/** Пустой Tiptap-документ: один пустой абзац. */
export const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Похоже ли значение на Tiptap-документ. */
export const isTiptapDoc = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.type === 'doc';

/**
 * Проверка документа из запроса.
 * Возвращает { ok: true, doc } либо { ok: false, message }.
 */
export function normalizeDoc(value) {
  if (value === undefined || value === null) {
    return { ok: true, doc: emptyDoc() };
  }

  if (!isTiptapDoc(value)) {
    return { ok: false, message: 'ожидается Tiptap-документ (type = "doc")' };
  }

  return { ok: true, doc: value };
}

/** Tiptap-документ из простого текста: каждая непустая строка — абзац. */
export function docFromText(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return emptyDoc();

  return {
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

/** Документ из запроса: Tiptap JSON или строка (например, из CSV). */
export function docFromInput(value) {
  if (typeof value === 'string') return { ok: true, doc: docFromText(value) };
  return normalizeDoc(value);
}

/**
 * Простой текст из Tiptap-документа (для поиска, заголовков и превью).
 * Внутри абзаца inline-узлы (например, части текста с разными метками)
 * склеиваются без пробела, а блоки разделяются separator.
 */
export function docToText(doc, separator = ' ') {
  const gap = String(separator ?? ' ');
  const inlineContent = new Set(['paragraph', 'heading', 'codeBlock']);

  const collect = (node) => {
    if (!node) return '';
    if (typeof node.text === 'string') return node.text;
    if (node.type === 'hardBreak') return gap;

    const children = Array.isArray(node.content) ? node.content : [];
    const glue = inlineContent.has(node.type) ? '' : gap;
    return children.map(collect).filter(Boolean).join(glue);
  };

  return collect(doc).replace(/\s+/g, ' ').trim();
}
