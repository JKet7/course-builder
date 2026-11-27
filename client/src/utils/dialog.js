/**
 * Диалог (бывший тип контента «Реплика»).
 *
 * Один фрагмент — сцена из нескольких реплик. У каждой реплики свой персонаж,
 * аватар, положение на слайде и текст; оформление (размер аватара, цвета,
 * толщина рамки, радиус, хвостик, выравнивание текста) — общее на сцену.
 *
 * Тип в базе остался 'replica': так работают уже сохранённые курсы и обмен
 * архивами, а в интерфейсе он называется «Диалог». Старый формат
 * ({ character, side, text }) нормализуется в одну реплику массива lines.
 *
 * Примечания и ссылки остаются общими для фрагмента (data.notes / data.links):
 * у каждой реплики поле 'text', а ref — id реплики (как ref ячейки в таблице).
 * Поэтому нумерация примечаний слайда и подсказки работают без изменений.
 *
 * Аватар показывается в кружке, поэтому у реплики есть выбор области картинки:
 * avatarFocus — точка (x/y в процентах), которая остаётся в кружке, avatarZoom —
 * масштаб внутри кружка. Раньше картинка просто обрезалась по центру.
 */

/** Пределы полей диалога (совпадает с server/src/utils/content.js). */
export const DIALOG_LIMITS = {
  lines: 20,
  text: 4000,
  character: 120,
  avatar: 1000,
  avatarSize: [40, 240],
  avatarZoom: [1, 3],
  borderWidth: [0, 8],
  radius: [0, 32],
};

/** Область аватара по умолчанию — центр картинки. */
export const DIALOG_FOCUS_DEFAULT = { x: 50, y: 50 };

/** Масштаб аватара по умолчанию и шаг ползунка. */
export const DIALOG_ZOOM_DEFAULT = 1;
export const DIALOG_ZOOM_STEP = 0.1;

/** Быстрый выбор области в кружке: 3 × 3 точки (x/y в процентах). */
export const DIALOG_FOCUS_POINTS = [
  { id: 'nw', x: 0, y: 0, label: 'Верхний левый угол' },
  { id: 'n', x: 50, y: 0, label: 'Сверху по центру' },
  { id: 'ne', x: 100, y: 0, label: 'Верхний правый угол' },
  { id: 'w', x: 0, y: 50, label: 'Слева по центру' },
  { id: 'c', x: 50, y: 50, label: 'По центру' },
  { id: 'e', x: 100, y: 50, label: 'Справа по центру' },
  { id: 'sw', x: 0, y: 100, label: 'Нижний левый угол' },
  { id: 's', x: 50, y: 100, label: 'Снизу по центру' },
  { id: 'se', x: 100, y: 100, label: 'Нижний правый угол' },
];

/** Точка фокуса аватара: 0–100 %, целые проценты. */
export function normalizeDialogFocus(value) {
  const source = value && typeof value === 'object' ? value : {};
  const point = (number, fallback) => {
    const parsed = Number(number);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(Math.min(100, Math.max(0, parsed)));
  };

  return { x: point(source.x, DIALOG_FOCUS_DEFAULT.x), y: point(source.y, DIALOG_FOCUS_DEFAULT.y) };
}

/** Масштаб аватара в кружке: 1–3 с шагом 0.1. */
export function normalizeDialogZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DIALOG_ZOOM_DEFAULT;

  const clamped = Math.min(DIALOG_LIMITS.avatarZoom[1], Math.max(DIALOG_LIMITS.avatarZoom[0], number));
  return Math.round(clamped * 10) / 10;
}

/**
 * Стили картинки в кружке аватара: выбранная область и масштаб.
 * Общие для просмотра, редактора и печати — кружок выглядит одинаково везде.
 */
export function dialogAvatarStyle(line) {
  const focus = normalizeDialogFocus(line?.avatarFocus);
  const zoom = normalizeDialogZoom(line?.avatarZoom);

  return {
    objectPosition: `${focus.x}% ${focus.y}%`,
    transform: zoom > 1 ? `scale(${zoom})` : undefined,
    transformOrigin: `${focus.x}% ${focus.y}%`,
  };
}

/** Положение реплики на слайде. */
export const DIALOG_SIDES = [
  { value: 'left', label: 'Слева', icon: 'alignLeft' },
  { value: 'center', label: 'По центру', icon: 'alignCenter' },
  { value: 'right', label: 'Справа', icon: 'alignRight' },
];

/** Положение персонажа относительно облака с текстом. */
export const DIALOG_POSITIONS = [
  { value: 'auto', label: 'Авто' },
  { value: 'left', label: 'Слева' },
  { value: 'right', label: 'Справа' },
  { value: 'top', label: 'Сверху' },
  { value: 'bottom', label: 'Снизу' },
];

/** Направление хвостика облака. */
export const DIALOG_TAILS = [
  { value: 'auto', label: 'Как у реплики' },
  { value: 'left', label: 'Слева' },
  { value: 'right', label: 'Справа' },
  { value: 'top', label: 'Сверху' },
  { value: 'bottom', label: 'Снизу' },
];

/** Выравнивание текста внутри облака. */
export const DIALOG_TEXT_ALIGNS = [
  { value: 'left', label: 'По левому краю' },
  { value: 'center', label: 'По центру' },
];

/** Цвета по умолчанию для поля выбора цвета (пусто = «как в теме»). */
export const DIALOG_COLOR_FALLBACK = {
  bubble: '#FFFFFF',
  border: '#2563EB',
};

const SIDE_VALUES = DIALOG_SIDES.map((item) => item.value);
const POSITION_VALUES = DIALOG_POSITIONS.map((item) => item.value);
const TAIL_VALUES = DIALOG_TAILS.map((item) => item.value);
const TEXT_ALIGN_VALUES = DIALOG_TEXT_ALIGNS.map((item) => item.value);
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

let lineCounter = 0;

/** Идентификатор новой реплики. */
export function createDialogLineId() {
  lineCounter += 1;
  return `line-${Date.now().toString(36)}-${lineCounter.toString(36)}`;
}

/** Новая реплика диалога. */
export function createDialogLine(overrides = {}) {
  return {
    id: createDialogLineId(),
    character: '',
    side: 'left',
    position: 'auto',
    avatar: '',
    // Кружок аватара: какая часть картинки видна и насколько крупно
    avatarFocus: { ...DIALOG_FOCUS_DEFAULT },
    avatarZoom: DIALOG_ZOOM_DEFAULT,
    text: '',
    ...overrides,
  };
}

/** Число в диапазоне [min, max] из настроек сцены. */
function clampOption(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

/** Цвет оформления: пусто — «как в теме», иначе #RRGGBB. */
export function normalizeDialogColor(value) {
  const text = String(value ?? '').trim();
  if (!HEX_COLOR.test(text)) return '';

  const hex = text.slice(1);
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  return `#${full.toUpperCase()}`;
}

/** Одна реплика: { id, character, side, position, avatar, avatarFocus, avatarZoom, text }. */
function normalizeLine(line, index) {
  const source = line && typeof line === 'object' ? line : {};

  return {
    id: String(source.id ?? '').slice(0, 60) || `line-${index + 1}`,
    character: String(source.character ?? '')
      .replace(/\s+/g, ' ')
      .trimStart()
      .slice(0, DIALOG_LIMITS.character),
    side: SIDE_VALUES.includes(source.side) ? source.side : 'left',
    position: POSITION_VALUES.includes(source.position) ? source.position : 'auto',
    avatar: String(source.avatar ?? '').trim().slice(0, DIALOG_LIMITS.avatar),
    // Старые реплики без этих полей показывают картинку по центру (как раньше)
    avatarFocus: normalizeDialogFocus(source.avatarFocus),
    avatarZoom: normalizeDialogZoom(source.avatarZoom),
    text: String(source.text ?? '').slice(0, DIALOG_LIMITS.text),
  };
}

/** Данные диалога по умолчанию: одна пустая реплика. */
export function defaultDialogData() {
  return {
    lines: [normalizeLine({ id: 'line-1' }, 0)],
    avatarSize: 72,
    bubbleColor: '',
    borderColor: '',
    borderWidth: 2,
    radius: 16,
    showTail: true,
    tail: 'auto',
    textAlign: 'left',
    notes: [],
    links: [],
  };
}

/**
 * data диалога с заполненными полями по умолчанию.
 * Старая «Реплика» ({ character, side, text }) становится одной репликой.
 */
export function normalizeDialogData(data) {
  const source = data && typeof data === 'object' ? data : {};
  const defaults = defaultDialogData();
  const rawLines = Array.isArray(source.lines) ? source.lines : [];

  let lines = rawLines
    .slice(0, DIALOG_LIMITS.lines)
    .filter((line) => line && typeof line === 'object')
    .map(normalizeLine);

  if (lines.length === 0) {
    lines = [
      normalizeLine({ id: 'line-1', character: source.character, side: source.side, text: source.text }, 0),
    ];
  }

  return {
    lines,
    avatarSize: clampOption(source.avatarSize, DIALOG_LIMITS.avatarSize, defaults.avatarSize),
    bubbleColor: normalizeDialogColor(source.bubbleColor),
    borderColor: normalizeDialogColor(source.borderColor),
    borderWidth: clampOption(source.borderWidth, DIALOG_LIMITS.borderWidth, defaults.borderWidth),
    radius: clampOption(source.radius, DIALOG_LIMITS.radius, defaults.radius),
    showTail: source.showTail !== false,
    tail: TAIL_VALUES.includes(source.tail) ? source.tail : defaults.tail,
    textAlign: TEXT_ALIGN_VALUES.includes(source.textAlign) ? source.textAlign : defaults.textAlign,
    notes: Array.isArray(source.notes) ? source.notes : [],
    links: Array.isArray(source.links) ? source.links : [],
  };
}

/**
 * Раскладка реплики: сторона слайда, место персонажа и куда смотрит хвостик.
 * «Авто» повторяет прежнюю «Реплику»: персонаж со стороны реплики,
 * у центральной реплики — сверху, хвостик смотрит на персонажа.
 */
export function getDialogLineLayout(line) {
  const side = SIDE_VALUES.includes(line?.side) ? line.side : 'left';
  const requested = POSITION_VALUES.includes(line?.position) ? line.position : 'auto';
  const position =
    requested !== 'auto' ? requested : side === 'right' ? 'right' : side === 'center' ? 'top' : 'left';

  return {
    side,
    position,
    tail: position === 'top' || position === 'bottom' ? position : position === 'right' ? 'right' : 'left',
  };
}

/** Направление хвостика: 'none' — без хвостика. */
export function getDialogTail(dialog, line) {
  if (dialog?.showTail === false) return 'none';

  const tail = TAIL_VALUES.includes(dialog?.tail) ? dialog.tail : 'auto';
  return tail === 'auto' ? getDialogLineLayout(line).tail : tail;
}

/** Первая буква имени для аватара без картинки. */
export function getDialogInitial(character) {
  const text = String(character ?? '').trim();
  return text ? [...text][0].toUpperCase() : '•';
}
