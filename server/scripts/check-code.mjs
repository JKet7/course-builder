// Проверки типа контента «Код» (Правка 8): нормализация и безопасность.
// Чистая функция server/src/utils/content.js — сервер и БД не нужны.
//
// Запуск: node scripts/check-code.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultContentData, normalizeContentData } from '../src/utils/content.js';

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
};

const normalize = (data) => normalizeContentData('code', data);

// Опасные символы не вырезаются: код должен остаться ровно таким, каким его
// вставили. Безопасность обеспечивает рендер — React выводит его текстом.
const evil = '<script>alert("x")</script>\n</code><img src=x onerror=alert(1)>';
const evilData = normalize({ code: evil }).data;
check('code: теги остаются текстом, а не разметкой', evilData.code === evil);
check('code: </code> не обрывает данные', evilData.code.includes('</code><img'));

const withNul = normalize({ code: 'a\u0000b\nc' }).data.code;
check('code: NUL заменён пробелом', withNul === 'a b\nc');
check('code: замена NUL не сдвигает позиции', withNul.length === 'a\u0000b\nc'.length);

const multiline = 'function add(a, b) {\n\treturn a + b;\n}';
check('code: переводы строк и табы сохранены', normalize({ code: multiline }).data.code === multiline);

check('code: неверный язык сводится к javascript', normalize({ language: 'cobol', code: '' }).data.language === 'javascript');
check('code: известный язык сохраняется', normalize({ language: 'python' }).data.language === 'python');
check('code: число вместо текста приводится к строке', normalize({ code: 42 }).data.code === '42');
check('code: имя файла сохраняется', normalize({ filename: 'src/index.js' }).data.filename === 'src/index.js');

const notes = [{ id: 'n1', text: 'Пояснение', field: 'code', from: 0, to: 3, word: 'const' }];
const links = [{ id: 'l1', kind: 'external', field: 'code', word: 'docs', href: 'https://example.com', newTab: true }];
const annotated = normalize({ code: 'const docs = 1;', notes, links }).data;
check('code: примечания к коду сохраняются', annotated.notes.length === 1 && annotated.notes[0].text === 'Пояснение');
check('code: ссылки в коде сохраняются', annotated.links.length === 1 && annotated.links[0].href === 'https://example.com');

check('code: пустые данные — пустой код', defaultContentData('code').code === '' && defaultContentData('code').language === 'javascript');
check('code: не-объект отклоняется', normalize('строка').ok === false);

const failed = results.filter((item) => !item.ok);

// Подробный отчёт пишем файлом: консоль Windows ломает кириллицу.
const reportPath = join(tmpdir(), 'check-code-report.txt');
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
