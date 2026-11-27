// Проверки типа контента «Картинка»: маркеры, обрезка, свободные пропорции,
// ширина и попадание маркеров в справку о блоке.
// Чистые функции server/src/utils/content.js и help.js — сервер и БД не нужны.
//
// Запуск: node scripts/check-image.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultContentData, normalizeContentData } from '../src/utils/content.js';
import { buildBlockHelp } from '../src/utils/help.js';

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
};

const normalize = (data) => normalizeContentData('image', data).data;

// --- Данные по умолчанию ---------------------------------------------------

const empty = defaultContentData('image');
check(
  'image: по умолчанию 100 %, по центру, без обрезки',
  empty.width === 100 && empty.align === 'center' && empty.crop === null && empty.aspect === null,
  JSON.stringify({ width: empty.width, align: empty.align, crop: empty.crop }),
);
check('image: пропорции сохраняются по умолчанию', empty.lockAspect === true);

// --- Маркеры: примечания с field = 'marker' и координатами ------------------

const markers = normalize({
  url: '/uploads/scheme.png',
  notes: [
    { id: 'm1', text: 'Серверная комната', field: 'marker', x: 12.3, y: 45.6 },
    { id: 'm2', text: 'Панель управления', field: 'marker', x: 150, y: -5 },
    { id: 'm3', text: 'Без координат', field: 'marker' },
    { id: 'm4', text: '', field: 'marker', x: 20, y: 20 },
    { id: 'm5', text: 'Подпись', field: 'caption' },
  ],
});

check('image: маркеры сохраняются с координатами', markers.notes.length === 4, JSON.stringify(markers.notes));
check(
  'image: координаты маркера в процентах',
  markers.notes[0].x === 12.3 && markers.notes[0].y === 45.6,
  JSON.stringify(markers.notes[0]),
);
check(
  'image: координаты обрезаны по краям картинки',
  markers.notes[1].x === 100 && markers.notes[1].y === 0,
  JSON.stringify(markers.notes[1]),
);
check('image: маркер без координат — в левом верхнем углу', markers.notes[2].x === 0 && markers.notes[2].y === 0);
check('image: маркер без текста отбрасывается', markers.notes.every((note) => note.text !== ''));
check('image: примечание подписи остаётся примечанием', markers.notes.some((note) => note.field === 'caption'));
check(
  'image: у обычного примечания нет координат',
  markers.notes.every((note) => note.field === 'marker' || (note.x === undefined && note.y === undefined)),
  JSON.stringify(markers.notes.filter((note) => note.field !== 'marker')),
);

// --- Обрезка ---------------------------------------------------------------

const cropped = normalize({ url: '/uploads/photo.png', crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } });
check(
  'image: обрезка сохраняется долями',
  cropped.crop && cropped.crop.x === 0.1 && cropped.crop.y === 0.2 && cropped.crop.w === 0.5 && cropped.crop.h === 0.6,
  JSON.stringify(cropped.crop),
);

const fullCrop = normalize({ url: '/uploads/photo.png', crop: { x: 0, y: 0, w: 1, h: 1 } });
check('image: обрезка во всю картинку сбрасывается', fullCrop.crop === null, JSON.stringify(fullCrop.crop));

const overCrop = normalize({ url: '/uploads/photo.png', crop: { x: 0.8, y: 0.9, w: 0.9, h: 0.9 } });
check(
  'image: обрезка не выходит за границы',
  overCrop.crop.x === 0.8 && overCrop.crop.w <= 0.2 && overCrop.crop.h <= 0.1,
  JSON.stringify(overCrop.crop),
);

const tinyCrop = normalize({ url: '/uploads/photo.png', crop: { x: 0, y: 0, w: 0, h: 0 } });
check(
  'image: минимальная сторона обрезки — 5 %',
  tinyCrop.crop && tinyCrop.crop.w === 0.05 && tinyCrop.crop.h === 0.05,
  JSON.stringify(tinyCrop.crop),
);

// --- Свободные пропорции и ширина -----------------------------------------

check('image: свободные пропорции сохраняются', normalize({ aspect: 0.66 }).aspect === 0.66);
check('image: неверные пропорции сбрасываются', normalize({ aspect: 50 }).aspect === null);
check('image: пропорции строкой приводятся к числу', normalize({ aspect: '0.5' }).aspect === 0.5);

check('image: ширина не меньше 10 %', normalize({ width: 5 }).width === 10);
check('image: ширина не больше 100 %', normalize({ width: 120 }).width === 100);
check('image: ширина строкой приводится к числу', normalize({ width: '40' }).width === 40);

check('image: «Сохранять пропорции» можно выключить', normalize({ lockAspect: false }).lockAspect === false);
check('image: по умолчанию пропорции включены', normalize({}).lockAspect === true);

// --- Рамки выделения (правка 2.5): фигуры поверх картинки ------------------

const shapes = normalize({
  url: '/uploads/scheme.png',
  shapes: [
    { id: 's1', type: 'rect', x: 10, y: 20, w: 30, h: 15, rotation: 15, color: '#e03131', fill: 25, stroke: 2 },
    { id: 's2', type: 'circle', x: 150, y: -20, w: 500, h: 0, color: 'красный', fill: 300, stroke: 9 },
    { type: 'arrow' },
    'мусор',
  ],
});

check('image: рамки выделения сохраняются', shapes.shapes.length === 3, JSON.stringify(shapes.shapes));
check(
  'image: фигура рамки из списка',
  shapes.shapes[0].type === 'rect' && shapes.shapes[2].type === 'arrow',
  shapes.shapes.map((shape) => shape.type).join(','),
);
check('image: неизвестная фигура становится прямоугольником', shapes.shapes[1].type === 'rect');
check(
  'image: цвет рамки приводится к #RRGGBB',
  shapes.shapes[0].color === '#E03131' && shapes.shapes[1].color === '#E03131',
  `${shapes.shapes[0].color} / ${shapes.shapes[1].color}`,
);
check(
  'image: рамка не выходит за границы картинки',
  shapes.shapes[1].x === 0 && shapes.shapes[1].y === 0 && shapes.shapes[1].w === 100 && shapes.shapes[1].h === 3,
  JSON.stringify(shapes.shapes[1]),
);
check('image: минимальная сторона рамки — 3 %', shapes.shapes[1].h === 3);
check('image: заливка 0–100 %, контур 0–4 px', shapes.shapes[1].fill === 100 && shapes.shapes[1].stroke === 4);
check('image: поворот рамки в градусах', shapes.shapes[0].rotation === 15);
check('image: поворот ограничен ±180°', normalize({ shapes: [{ rotation: 400 }] }).shapes[0].rotation === 180);
check('image: рамка без id получает номер', shapes.shapes[2].id === 'shape-3', shapes.shapes[2].id);
check('image: пустой список рамок по умолчанию', Array.isArray(empty.shapes) && empty.shapes.length === 0);
check(
  'image: лимит рамок — 20',
  normalize({ shapes: Array.from({ length: 30 }, () => ({ type: 'rect' })) }).shapes.length === 20,
);

// --- Маркеры в справке о блоке --------------------------------------------

const helpBlock = {
  id: 'block-image',
  type: 'theory',
  title: 'Схема помещения',
  updatedAt: '2026-11-20T10:00:00.000Z',
  slides: [
    {
      id: 'slide-1',
      title: 'План',
      contents: [
        {
          id: 'content-1',
          type: 'image',
          data: normalize({
            url: '/uploads/scheme.png',
            caption: 'План этажа',
            notes: [
              { id: 'm1', text: 'Серверная комната', field: 'marker', x: 30, y: 40 },
              { id: 'm2', text: 'Панель управления', field: 'marker', x: 70, y: 20 },
            ],
          }),
        },
      ],
    },
  ],
};

const help = buildBlockHelp(helpBlock, { id: 'course-1', blocks: [helpBlock] });
check('image: маркеры попали в справку', help.notes.length === 2, JSON.stringify(help.notes));
check(
  'image: справка показывает текст и место маркера',
  help.notes[0].text === 'Серверная комната' && help.notes[0].place === 'слайд 1',
  JSON.stringify(help.notes[0]),
);
check('image: номера маркеров в справке по порядку', help.notes[1].number === 2, JSON.stringify(help.notes[1]));

const failed = results.filter((item) => !item.ok);

// Подробный отчёт пишем файлом: консоль Windows ломает кириллицу.
const reportPath = join(tmpdir(), 'check-image-report.txt');
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
