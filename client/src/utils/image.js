/**
 * Картинка: обрезка, свободные пропорции и интерактивные маркеры.
 *
 * Маркер — это примечание обычного текста (data.notes) с field = 'marker'
 * и координатами x/y в процентах от видимой области картинки (после обрезки).
 * Поэтому маркеры нумеруются вместе с остальными примечаниями слайда
 * (сквозняком), показывают ту же подсказку, что примечания текста, и попадают
 * в «Справку о блоке» — отдельного хранилища и отдельной нумерации не нужно.
 *
 * Обрезка хранится как доли исходной картинки: { x, y, w, h } в диапазоне 0–1.
 * Свободные пропорции — отношение высоты к ширине (null — натуральные), чтобы
 * картинка одинаково выглядела и в колонке, и в печати.
 */

import { IMAGE_MARKER_FIELD, collectPlainNotes, createNoteId, normalizeNoteText } from './notes.js';
import { normalizeHex } from './themes.js';

export { IMAGE_MARKER_FIELD };

/** Предел числа маркеров у одной картинки. */
export const IMAGE_MARKERS_LIMIT = 30;

/** Ширина картинки в колонке, %: от 10 до 100. */
export const IMAGE_WIDTH_MIN = 10;
export const IMAGE_WIDTH_MAX = 100;

/** Минимальная сторона области обрезки — 5 % картинки. */
const CROP_MIN = 0.05;

const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/** Координата маркера в процентах от картинки: 0–100, один знак после запятой. */
export function clampMarkerPoint(value, fallback = 50) {
  return Math.round(clamp(toNumber(value, fallback), 0, 100) * 10) / 10;
}

/** Ширина картинки в колонке, % (10–100). */
export function clampImageWidth(value, fallback = IMAGE_WIDTH_MAX) {
  return Math.round(clamp(toNumber(value, fallback), IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX));
}

/**
 * Обрезка картинки: { x, y, w, h } в долях исходника.
 * null — обрезки нет (или она закрывает картинку целиком).
 */
export function normalizeCrop(value) {
  if (!value || typeof value !== 'object') return null;

  const x = clamp(toNumber(value.x, 0), 0, 1 - CROP_MIN);
  const y = clamp(toNumber(value.y, 0), 0, 1 - CROP_MIN);
  const w = clamp(toNumber(value.w, 1), CROP_MIN, 1 - x);
  const h = clamp(toNumber(value.h, 1), CROP_MIN, 1 - y);

  if (x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999) return null;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Пропорции после обрезки: высота / ширина видимой области. */
export function normalizeAspect(value) {
  const ratio = toNumber(value, 0);
  return ratio > 0.05 && ratio < 20 ? round(ratio, 3) : null;
}

/**
 * CSS aspect-ratio (ширина / высота) рамки картинки.
 * naturalRatio — высота / ширина загруженного файла; null, пока он не загрузился.
 */
export function imageFrameRatio(data, naturalRatio) {
  const free = normalizeAspect(data?.aspect);
  const crop = normalizeCrop(data?.crop);
  const natural = Number(naturalRatio);

  if (free) return round(1 / free, 3);
  if (!Number.isFinite(natural) || natural <= 0) return null;
  return round(1 / (natural * (crop ? crop.h / crop.w : 1)), 3);
}

/**
 * Стили картинки внутри рамки: при обрезке картинка сдвигается и растягивается,
 * поэтому видимой остаётся только выбранная область (object-fit: fill — при
 * свободных пропорциях картинка занимает рамку целиком).
 */
export function cropImageStyle(crop) {
  const rect = normalizeCrop(crop);
  if (!rect) return null;

  return {
    position: 'absolute',
    width: `${round(100 / rect.w, 2)}%`,
    height: `${round(100 / rect.h, 2)}%`,
    left: `${round((-rect.x / rect.w) * 100, 2)}%`,
    top: `${round((-rect.y / rect.h) * 100, 2)}%`,
    objectFit: 'fill',
  };
}

/** Маркеры картинки из data.notes в порядке нумерации примечаний слайда. */
export function collectImageMarkers(data) {
  return collectPlainNotes(data).filter((note) => note.field === IMAGE_MARKER_FIELD);
}

/** Новый маркер в точке (x, y) — проценты от картинки. */
export function createImageMarker({ x = 50, y = 50, text = '' } = {}) {
  return {
    id: createNoteId(),
    text: normalizeNoteText(text),
    field: IMAGE_MARKER_FIELD,
    ref: '',
    from: 0,
    to: 0,
    word: '',
    x: clampMarkerPoint(x),
    y: clampMarkerPoint(y),
  };
}

/** Добавить маркер к data.notes; сверх лимита — без изменений. */
export function addImageMarker(notes, marker) {
  const list = Array.isArray(notes) ? notes : [];
  if (!marker?.id || list.length >= IMAGE_MARKERS_LIMIT) return list;
  return [...list, marker];
}

/**
 * Текст маркера. Пустой текст не сохраняется: маркер без пояснения
 * удаляется (сервер тоже не хранит примечания без текста).
 */
export function setImageMarkerText(notes, markerId, rawText) {
  const list = Array.isArray(notes) ? notes : [];
  const text = normalizeNoteText(rawText);
  if (!text) return list.filter((note) => note.id !== markerId);
  return list.map((note) => (note.id === markerId ? { ...note, text } : note));
}

/** Переместить маркер: координаты в процентах, с ограничением по краям. */
export function moveImageMarker(notes, markerId, x, y) {
  return (notes ?? []).map((note) =>
    note.id === markerId ? { ...note, x: clampMarkerPoint(x), y: clampMarkerPoint(y) } : note,
  );
}

/** Удалить маркер из data.notes — нумерация остальных пересчитается сама. */
export function removeImageMarker(notes, markerId) {
  return (notes ?? []).filter((note) => note.id !== markerId);
}

/* --------------------------------------- рамки выделения (правка, часть 2) */

/**
 * Рамка выделения — цветная фигура поверх картинки: прямоугольник, круг,
 * треугольник или стрелка. Геометрия хранится в процентах от видимой области
 * (после обрезки), поэтому фигуры не зависят от ширины колонки и одинаково
 * выглядят на экране и в печати.
 *
 * Поворот — в градусах (−180…180), заливка — прозрачность в процентах (0–100),
 * контур — толщина в пикселях (0–4). Цвет — HEX: из палитры «Цвета темы» или
 * из фиксированного набора «Цвета системы».
 */

/** Предел числа рамок у одной картинки. */
export const IMAGE_SHAPES_LIMIT = 20;

/** Фигуры рамок в порядке меню «Добавить рамку». */
export const IMAGE_SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'arrow'];

/** Названия фигур для меню и списка рамок. */
export const IMAGE_SHAPE_LABELS = {
  rect: 'Прямоугольник',
  ellipse: 'Круг',
  triangle: 'Треугольник',
  arrow: 'Стрелка',
};

/** Иконки фигур (реестр components/ui/Icon.jsx). */
export const IMAGE_SHAPE_ICONS = {
  rect: 'square',
  ellipse: 'circle',
  triangle: 'triangle',
  arrow: 'arrowRight',
};

/** Минимальная сторона рамки — 3 % видимой области картинки. */
export const IMAGE_SHAPE_MIN_SIZE = 3;

/** Пределы оформления: заливка 0–100 %, контур 0–4 px. */
export const IMAGE_SHAPE_FILL_MAX = 100;
export const IMAGE_SHAPE_STROKE_MAX = 4;

/** Цвет новой рамки — «красный» из набора «Цвета системы». */
export const IMAGE_SHAPE_DEFAULT_COLOR = '#E03131';

/** «Цвета системы»: фиксированный набор с названиями для списка рамок. */
export const IMAGE_SHAPE_SYSTEM_COLORS = [
  { value: '#E03131', name: 'красный' },
  { value: '#2F71C8', name: 'синий' },
  { value: '#2F9E44', name: 'зелёный' },
  { value: '#E0A458', name: 'оранжевый' },
  { value: '#8B5CF6', name: 'фиолетовый' },
  { value: '#0D9488', name: 'бирюзовый' },
  { value: '#1F1B16', name: 'чёрный' },
  { value: '#FFFFFF', name: 'белый' },
];

/** Названия ролей темы для подписи цвета рамки. */
const THEME_ROLE_NAMES = {
  accent: 'акцент',
  muted: 'приглушённый',
  background: 'фон',
  surface: 'поверхность',
  text: 'текст',
  border: 'границы',
};

/** Идентификатор новой рамки. */
export function createShapeId() {
  return `shape-${Math.random().toString(36).slice(2, 10)}`;
}

/** Координата или размер рамки в процентах: один знак после запятой. */
export function clampShapeNumber(value, fallback = 0, min = 0, max = 100) {
  return Math.round(clamp(toNumber(value, fallback), min, max) * 10) / 10;
}

/** Поворот рамки: целые градусы от −180 до 180. */
export function clampShapeRotation(value) {
  return Math.round(clamp(toNumber(value, 0), -180, 180));
}

/** Прозрачность заливки: 0–100 %. */
export function clampShapeFill(value) {
  return Math.round(clamp(toNumber(value, 0), 0, IMAGE_SHAPE_FILL_MAX));
}

/** Толщина контура: 0–4 px. */
export function clampShapeStroke(value) {
  return Math.round(clamp(toNumber(value, 2), 0, IMAGE_SHAPE_STROKE_MAX));
}

/**
 * Нормализация рамки: { id, type, x, y, w, h, rotation, color, fill, stroke }.
 * fallbackId нужен старым данным без идентификатора — он стабилен в пределах списка.
 * Рамка не выходит за границы картинки: x + w ≤ 100, y + h ≤ 100.
 */
export function normalizeShape(value, fallbackId = 'shape-1') {
  if (!value || typeof value !== 'object') return null;

  const type = IMAGE_SHAPE_TYPES.includes(value.type) ? value.type : 'rect';
  const w = clampShapeNumber(value.w, 20, IMAGE_SHAPE_MIN_SIZE, 100);
  const h = clampShapeNumber(value.h, 20, IMAGE_SHAPE_MIN_SIZE, 100);

  return {
    id: String(value.id ?? '') || fallbackId,
    type,
    x: clampShapeNumber(value.x, 0, 0, 100 - w),
    y: clampShapeNumber(value.y, 0, 0, 100 - h),
    w,
    h,
    rotation: clampShapeRotation(value.rotation),
    color: normalizeHex(value.color) ?? IMAGE_SHAPE_DEFAULT_COLOR,
    fill: clampShapeFill(value.fill),
    stroke: clampShapeStroke(value.stroke),
  };
}

/** Список рамок картинки: мусор отбрасывается, лишние обрезаются по лимиту. */
export function normalizeShapes(value) {
  if (!Array.isArray(value)) return [];

  const shapes = [];
  for (const [index, item] of value.slice(0, IMAGE_SHAPES_LIMIT).entries()) {
    const shape = normalizeShape(item, `shape-${index + 1}`);
    if (shape) shapes.push(shape);
  }

  return shapes;
}

/** Рамки картинки из data.shapes (старые данные без рамок — пустой список). */
export function collectImageShapes(data) {
  return normalizeShapes(data?.shapes);
}

/** Прямоугольник по двум точкам — для рисования рамки мышью. */
export function rectFromPoints(start, end) {
  return {
    x: clampShapeNumber(Math.min(start?.x ?? 0, end?.x ?? 0)),
    y: clampShapeNumber(Math.min(start?.y ?? 0, end?.y ?? 0)),
    w: clampShapeNumber(Math.abs((end?.x ?? 0) - (start?.x ?? 0))),
    h: clampShapeNumber(Math.abs((end?.y ?? 0) - (start?.y ?? 0))),
  };
}

/** Новая рамка выбранной фигуры. */
export function createImageShape({
  type = 'rect',
  x = 20,
  y = 20,
  w = 30,
  h = 20,
  color = IMAGE_SHAPE_DEFAULT_COLOR,
  fill = 0,
  stroke = 2,
} = {}) {
  return normalizeShape({ id: createShapeId(), type, x, y, w, h, rotation: 0, color, fill, stroke });
}

/** Добавить рамку к data.shapes; сверх лимита — без изменений. */
export function addImageShape(shapes, shape) {
  const list = Array.isArray(shapes) ? shapes : [];
  if (!shape?.id || list.length >= IMAGE_SHAPES_LIMIT) return list;
  return [...list, shape];
}

/** Изменить рамку (положение, размер, поворот, цвет, заливка, контур). */
export function updateImageShape(shapes, shapeId, patch) {
  return (shapes ?? []).map((shape) => {
    if (shape.id !== shapeId) return shape;
    return normalizeShape({ ...shape, ...patch }, shape.id);
  });
}

/** Переместить рамку: координаты в процентах от картинки. */
export function moveImageShape(shapes, shapeId, x, y) {
  return updateImageShape(shapes, shapeId, { x, y });
}

/** Изменить размер и положение рамки одним прямоугольником. */
export function resizeImageShape(shapes, shapeId, rect) {
  return updateImageShape(shapes, shapeId, rect);
}

/** Удалить рамку из data.shapes. */
export function removeImageShape(shapes, shapeId) {
  return (shapes ?? []).filter((shape) => shape.id !== shapeId);
}

/**
 * Название цвета для списка рамок: цвета «Цвета системы» и роли темы — по имени,
 * остальные цвета палитры — по номеру, свой HEX — «свой цвет».
 * colors — объект colors темы ({ accent, themeColors, … }).
 */
export function shapeColorLabel(color, colors = null) {
  const hex = normalizeHex(color);
  if (!hex) return 'по умолчанию';

  const system = IMAGE_SHAPE_SYSTEM_COLORS.find((item) => item.value === hex);
  if (system) return system.name;

  for (const [key, name] of Object.entries(THEME_ROLE_NAMES)) {
    if (normalizeHex(colors?.[key]) === hex) return name;
  }

  const palette = Array.isArray(colors?.themeColors) ? colors.themeColors : [];
  const index = palette.findIndex((item) => normalizeHex(item) === hex);
  if (index >= 0) return `цвет темы ${index + 1}`;

  return 'свой цвет';
}

/** Строка списка рамок: «Прямоугольник (красный)». */
export function shapeTitle(shape, colors = null) {
  const label = IMAGE_SHAPE_LABELS[shape?.type] ?? IMAGE_SHAPE_LABELS.rect;
  return `${label} (${shapeColorLabel(shape?.color, colors)})`;
}

/** Стили рамки на картинке: положение, размер и поворот вокруг центра. */
export function shapeBoxStyle(shape) {
  return {
    left: `${shape.x}%`,
    top: `${shape.y}%`,
    width: `${shape.w}%`,
    height: `${shape.h}%`,
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
  };
}
