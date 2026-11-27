// Проверки типа контента «Таблица»: ячейки-документы, объединения, миграция.
// Чистые функции server/src/utils/content.js — сервер и БД не нужны.
//
// Запуск: node scripts/check-table.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_LIMITS, defaultContentData, normalizeContentData } from '../src/utils/content.js';

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
};

const normalize = (data) => normalizeContentData('table', data).data;
const isDoc = (value) => Boolean(value) && typeof value === 'object' && value.type === 'doc';
const text = (doc) =>
  (doc?.content ?? [])
    .flatMap((node) => (node.content ?? []).map((child) => child.text ?? ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

// --- Данные по умолчанию ---------------------------------------------------

const empty = defaultContentData('table');
check(
  'table: по умолчанию 2×2 пустых документа',
  empty.columns === 2 &&
    empty.rows === 2 &&
    empty.cells.length === 2 &&
    empty.cells[0].length === 2 &&
    empty.cells.every((row) => row.every(isDoc)) &&
    empty.merges.length === 0,
  JSON.stringify(empty).slice(0, 160),
);
check('table: шапка включена по умолчанию', empty.headerRow === true);

// --- Старый формат: строки + data.notes/data.links -------------------------

const legacy = normalize({
  columns: 2,
  rows: 1,
  headerRow: false,
  cells: [['Срок хранения', 'Год']],
  notes: [{ id: 'n1', text: 'Из ГОСТ', field: 'cell', ref: '0-0', from: 0, to: 4, word: 'Срок' }],
  links: [
    { id: 'l1', kind: 'internal', field: 'cell', ref: '0-1', href: '/block/b1', word: 'Год', from: 0, to: 3, targetBlockId: 'b1', targetType: 'block' },
  ],
});

check('table: строка стала документом', isDoc(legacy.cells[0][0]) && text(legacy.cells[0][0]) === 'Срок хранения');
check(
  'table: примечание стало меткой inlineNote',
  legacy.cells[0][0].content[0].content[0].marks?.[0]?.type === 'inlineNote' &&
    legacy.cells[0][0].content[0].content[0].marks[0].attrs.noteId === 'n1',
  JSON.stringify(legacy.cells[0][0]).slice(0, 200),
);
check(
  'table: ссылка стала меткой link',
  legacy.cells[0][1].content[0].content[0].marks?.[0]?.type === 'link' &&
    legacy.cells[0][1].content[0].content[0].marks[0].attrs.targetBlockId === 'b1',
  JSON.stringify(legacy.cells[0][1]).slice(0, 200),
);
check(
  'table: отдельные notes/links в data больше не остаются',
  legacy.notes === undefined && legacy.links === undefined,
  JSON.stringify(Object.keys(legacy)),
);

// Диапазон «съехал» после ручной правки — слово ищется заново по word
const drifted = normalize({
  columns: 1,
  rows: 1,
  cells: [['Срочно срок хранения']],
  notes: [{ id: 'n2', text: 'Правка', field: 'cell', ref: '0-0', from: 0, to: 4, word: 'срок' }],
});
check(
  'table: примечание ищет слово заново',
  drifted.cells[0][0].content[0].content.find((node) => node.marks?.length)?.text === 'срок',
  JSON.stringify(drifted.cells[0][0]).slice(0, 200),
);

// --- Объединения -----------------------------------------------------------

const merged = normalize({
  columns: 3,
  rows: 2,
  headerRow: false,
  cells: [['Итог', 'мусор', 'ещё'], ['низ', '', '']],
  merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
});
check('table: объединение сохраняется', merged.merges.length === 1 && merged.merges[0].colSpan === 2, JSON.stringify(merged.merges));
check('table: текст в закрытой ячейке очищен', text(merged.cells[0][1]) === '', JSON.stringify(merged.cells[0][1]));
check('table: текст верхней левой ячейки на месте', text(merged.cells[0][0]) === 'Итог');

const clamped = normalize({
  columns: 3,
  rows: 2,
  cells: [['a', 'b', 'c'], ['d', 'e', 'f']],
  merges: [
    { row: 0, col: 0, rowSpan: 99, colSpan: 99 },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
    { row: 1, col: 2, rowSpan: 1, colSpan: 5 },
    { row: 0, col: 1, rowSpan: 1, colSpan: 2 },
  ],
});
check(
  'table: объединение обрезано по границам',
  clamped.merges[0].rowSpan === 2 && clamped.merges[0].colSpan === 3,
  JSON.stringify(clamped.merges),
);
check('table: пересечения и одиночные ячейки отброшены', clamped.merges.length === 1, JSON.stringify(clamped.merges));

// --- Ограничения размеров --------------------------------------------------

const big = normalize({
  columns: 99,
  rows: 99,
  cells: Array.from({ length: 99 }, () => Array.from({ length: 99 }, () => '')),
});
check(
  'table: размеры в пределах лимитов',
  big.columns === CONTENT_LIMITS.tableColumns && big.rows === CONTENT_LIMITS.tableRows,
  `${big.columns}×${big.rows}`,
);

const docCell = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Жирный', marks: [{ type: 'bold' }] }] }] };
const kept = normalize({ columns: 1, rows: 1, headerRow: true, cells: [[docCell]] });
check(
  'table: готовый документ ячейки не пересобирается',
  kept.cells[0][0] === docCell || JSON.stringify(kept.cells[0][0]) === JSON.stringify(docCell),
  JSON.stringify(kept.cells[0][0]),
);
check('table: не-объект в ячейке становится пустым документом', text(normalize({ columns: 1, rows: 1, cells: [[42]] }).cells[0][0]) === '42');

const failed = results.filter((item) => !item.ok);

// Подробный отчёт пишем файлом: консоль Windows ломает кириллицу.
const reportPath = join(tmpdir(), 'check-table-report.txt');
const report = results
  .map((item) => `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `\n        ${item.detail}` : ''}`)
  .join('\n');
writeFileSync(reportPath, `${report}\n\n${results.length - failed.length}/${results.length} проверок пройдено\n`, 'utf8');

for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok || !item.detail ? '' : ` (${item.detail})`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`Отчёт: ${reportPath}`);
process.exitCode = failed.length ? 1 : 0;
