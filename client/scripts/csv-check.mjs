/**
 * Проверка импорта и экспорта CSV блока «Тест» без браузера:
 * три шаблона из модалки, старый формат, обратный экспорт.
 *
 * Запуск: node scripts/csv-check.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { csvToQuestions, decodeCsvBytes, parseCsv, questionsToCsv, TEST_CSV_TEMPLATES } from '../src/utils/csv.js';

const results = [];

const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true, detail: '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
};

const parse = (text) => csvToQuestions(parseCsv(text).rows);
const correct = (options = []) => options.filter((option) => option.isCorrect).map((option) => option.text);
const template = (id) => TEST_CSV_TEMPLATES.find((item) => item.id === id);

// ===== Парсер CSV =====
check('parseCsv: BOM, кавычки и перевод строки внутри ячейки', () => {
  const { rows, delimiter } = parseCsv('\uFEFFВопрос;Ответ\n"Кто, где?";"a ""b""\nc"');
  assert.equal(delimiter, ';');
  assert.deepEqual(rows[1], ['Кто, где?', 'a "b"\nc']);
});

check('parseCsv: запятая как разделитель', () => {
  assert.equal(parseCsv('a,b,c\n1,2,3').delimiter, ',');
});
check('decodeCsvBytes: UTF-8 с BOM и windows-1251 без BOM', () => {
  assert.equal(decodeCsvBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), 'A');
  // «Привет» в windows-1251 — как сохраняет старый Excel
  assert.equal(decodeCsvBytes(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])), 'Привет');
  assert.equal(decodeCsvBytes(new ArrayBuffer(0)), '');
});


// ===== Шаблоны из модалки импорта =====
check('шаблон «Вопросы»: одиночный и множественный', () => {
  const { items, errors } = parse(template('quiz').content);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((item) => item.type), ['single', 'multiple']);
  assert.deepEqual(correct(items[0].options), ['A']);
  assert.deepEqual(correct(items[1].options), ['A', 'E']);
  assert.equal(items[0].group, 'Артикли');
  assert.ok(items[0].explanation);
});

check('шаблон «Карточки»: две карточки с группой', () => {
  const { items, errors } = parse(template('cards').content);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((item) => item.type), ['card', 'card']);
  assert.deepEqual(items[0].data, { front: 'nature', back: 'природа' });
  assert.equal(items[1].group, 'Слова');
});

check('шаблон «Соответствие»: пары одной группы и пустые строки-заготовки', () => {
  const text = [template('match').content, 'Пара 9;;;', 'Пара 10;;;'].join('\r\n');
  const { items, errors } = parse(text);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'match');
  assert.equal(items[0].pairs.length, 3);
  assert.deepEqual(items[0].pairs[0], { left: 'cat', right: 'кошка' });
  assert.equal(items[0].group, 'Слова');
  assert.equal(items[0].data.text, 'Сопоставьте пары');
});
// ===== Старый формат без заголовка =====
check('старый формат: варианты, номера верных и пояснение', () => {
  const { items, errors } = parse('Текст;A;An;The;1,3;Пояснение\nВторой;Да;Нет;1;');
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'multiple');
  assert.deepEqual(correct(items[0].options), ['A', 'The']);
  assert.equal(items[1].type, 'single');
  assert.deepEqual(correct(items[1].options), ['Да']);
});

check('старый формат: маркеры «карточка» и «соответствие»', () => {
  const { items, errors } = parse('карточка;nature;природа\nсоответствие;Слова;cat = кошка;dog = собака');
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((item) => item.type), ['card', 'match']);
  assert.equal(items[1].pairs.length, 2);
});

check('старый формат: заголовок с колонкой «Номер», а не «Правильный ответ»', () => {
  const { items, errors } = parse(
    'вопрос;вариант 1;вариант 2;номер\n"Что такое СИЗ?";"Средства; защиты";Шарф;1',
  );
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'single');
  assert.deepEqual(correct(items[0].options), ['Средства; защиты']);
  assert.equal(items[0].line, 2);
});

check('колонка «Тип» задаёт одиночный и множественный', () => {
  const text = [
    'Тип;Вопрос;Вариант 1;Вариант 2;Правильный ответ;Группа',
    'один ответ;Текст;A;B;A;Группа 1',
    'несколько ответов;Текст 2;A;B;A|B;Группа 1',
  ].join('\n');
  const { items, errors } = parse(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((item) => item.type), ['single', 'multiple']);
});
// ===== Ошибки разбора =====
check('ошибка: верного ответа нет среди вариантов', () => {
  const { items, errors } = parse('Вопрос;Вариант 1;Вариант 2;Правильный ответ\nТекст;A;B;C');
  assert.equal(items.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Правильном ответе/);
});

check('ошибка: для сопоставления нужна вторая пара', () => {
  const { errors } = parse(';Лево;Право;Группа\nПара 1;cat;кошка;Слова');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /минимум две пары/);
});

// ===== Экспорт =====
check('экспорт: однотипные тесты получают компактный заголовок', () => {
  const cardsCsv = questionsToCsv([{ type: 'card', data: { front: 'a', back: 'b' }, group: { name: 'G' } }]);
  const quizCsv = questionsToCsv([
    { type: 'single', data: { text: 'Q' }, options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] },
  ]);

  assert.equal(cardsCsv.split('\r\n')[0], 'Передняя сторона;Задняя сторона;Группа');
  assert.equal(quizCsv.split('\r\n')[0], 'Вопрос;Вариант 1;Вариант 2;Правильный ответ;Объяснение;Группа');
});

check('экспорт → импорт: смешанный тест сохраняет группы и пары', () => {
  const questions = [
    {
      type: 'single',
      data: { text: 'Какой артикль?' },
      options: [{ text: 'A', isCorrect: true }, { text: 'An', isCorrect: false }],
      explanation: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Перед cat' }] }] },
      group: { name: 'Артикли' },
    },
    { type: 'card', data: { front: 'nature', back: 'природа' }, options: [], pairs: [], group: { name: 'Слова' } },
    {
      type: 'match',
      data: { text: 'Сопоставьте' },
      options: [],
      pairs: [{ left: 'cat', right: 'кошка' }, { left: 'dog', right: 'собака' }],
      group: { name: 'Слова' },
    },
  ];

  const { items, errors } = parse(questionsToCsv(questions));
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((item) => item.type), ['single', 'card', 'match']);
  assert.deepEqual(items.map((item) => item.group), ['Артикли', 'Слова', 'Слова']);
  assert.deepEqual(items[2].pairs, questions[2].pairs);
  assert.deepEqual(correct(items[0].options), ['A']);
});

check('экспорт: группа строкой тоже попадает в CSV', () => {
  const csv = questionsToCsv([{ type: 'card', data: { front: 'a', back: 'b' }, group: 'Слова' }]);
  assert.match(csv, /a;b;Слова/);
});

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

await writeFile(
  fileURLToPath(new URL('../csv-check.json', import.meta.url)),
  JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2),
  'utf8',
);

process.exitCode = failed.length ? 1 : 0;



