/**
 * Обычный текст с аннотациями (Правки 5–6): примечания и внутренние ссылки
 * хранятся не в самом тексте, а рядом (data.notes / data.links) и привязаны
 * к диапазону слова `from`/`to` и его копии `word`.
 *
 * Модуль общий для utils/notes.js и utils/links.js: обе аннотации
 * раскладываются по тексту одинаково, поэтому подчёркивание, номера
 * и ссылки не расходятся, если поле правили вручную.
 */

/**
 * Диапазоны аннотаций: [{ item, from, to }], отсортированные по началу.
 * Если сохранённый диапазон не совпадает с текстом (поле правили), слово
 * ищется заново по сохранённому `word`; если и его нет — аннотация
 * ставится в конец текста.
 */
export function placeTextRanges(value, items = []) {
  const text = String(value ?? '');
  const placed = [];

  for (const item of items ?? []) {
    let from = Number(item.from);
    let to = Number(item.to);
    const word = String(item.word ?? '');

    const exact =
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      from >= 0 &&
      to > from &&
      to <= text.length &&
      (!word || text.slice(from, to) === word);

    if (!exact) {
      if (word) {
        const index = text.indexOf(word);
        if (index >= 0) {
          from = index;
          to = index + word.length;
        } else {
          from = text.length;
          to = text.length;
        }
      } else {
        from = 0;
        to = text.length;
      }
    }

    placed.push({ item, from, to });
  }

  return placed.sort((a, b) => a.from - b.from);
}

/**
 * Текст, разбитый по диапазонам: [{ text, item }].
 * Куски вне диапазонов получают item = null.
 */
export function splitByRanges(value, ranges = []) {
  const text = String(value ?? '');
  const parts = [];
  let cursor = 0;

  for (const range of ranges ?? []) {
    if (range.from < cursor) continue;
    if (range.from > cursor) parts.push({ text: text.slice(cursor, range.from), item: null });
    parts.push({ text: text.slice(range.from, range.to), item: range.item });
    cursor = range.to;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), item: null });
  return parts;
}

/**
 * Текст сразу с примечаниями и ссылками: [{ text, note, link, noteEnd }].
 * `noteEnd` — кусок заканчивает примечание (после него рисуется номер).
 * Если одна и та же фраза помечена и примечанием, и ссылкой, кусок получает
 * обе аннотации: номер остаётся снаружи, ссылка внутри.
 */
export function annotateText(value, notes = [], links = []) {
  const text = String(value ?? '');
  const noteRanges = placeTextRanges(text, notes);
  const linkRanges = placeTextRanges(text, links);

  const points = new Set([0, text.length]);
  for (const range of [...noteRanges, ...linkRanges]) {
    points.add(range.from);
    points.add(range.to);
  }

  const sorted = [...points].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);
  const parts = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (to <= from) continue;

    const noteRange = noteRanges.find((range) => range.from <= from && range.to >= to);
    const linkRange = linkRanges.find((range) => range.from <= from && range.to >= to);

    parts.push({
      text: text.slice(from, to),
      note: noteRange?.item ?? null,
      link: linkRange?.item ?? null,
      noteEnd: Boolean(noteRange) && noteRange.to === to,
    });
  }

  return parts;
}
