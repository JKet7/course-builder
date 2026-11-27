/**
 * Темы оформления (Шаг 12): роли цветов, палитра и нормализация.
 *
 * Структура colors (JSON в Theme.colors):
 *   accent | muted | background | surface | text | border — HEX-цвета интерфейса,
 *   themeColors — палитра из 10 цветов для тулбара редактора («Цвета темы»).
 * Значения по умолчанию совпадают с client/src/utils/themes.js и CSS-переменными
 * из client/src/styles/themes.css (тема «Классическая»).
 */

/** Роли цвета: каждая обязательна и попадает в CSS-переменную на клиенте. */
export const THEME_COLOR_KEYS = ['accent', 'muted', 'background', 'surface', 'text', 'border'];

/** Подписи ролей для сообщений об ошибках. */
export const THEME_COLOR_LABELS = {
  accent: 'Акцент',
  muted: 'Приглушённый текст',
  background: 'Фон страницы',
  surface: 'Поверхность карточек',
  text: 'Основной текст',
  border: 'Границы',
};

/** Длина палитры «Цвета темы» (10 цветов в 2 ряда в тулбаре). */
export const THEME_PALETTE_SIZE = 10;

/** Ограничения тем. */
export const THEME_LIMITS = {
  name: 60,
  personal: 20, // личных тем на пользователя
};

/** Тема «Классическая» — значения по умолчанию. */
export const DEFAULT_THEME_COLORS = {
  accent: '#8B2332',
  muted: '#B08968',
  background: '#FAF6EE',
  surface: '#FFFFFF',
  text: '#1F1B16',
  border: '#E4DCCF',
  themeColors: [
    '#8B2332',
    '#C46A4B',
    '#E0A458',
    '#D9C6A5',
    '#B08968',
    '#2F6F6B',
    '#1E6E5C',
    '#6C8A5B',
    '#4A6C8C',
    '#6B5B95',
  ],
};

/** Тема «Тёмная» — второй глобальный пресет из сида. */
export const DARK_THEME_COLORS = {
  accent: '#60A5FA',
  muted: '#9CA3AF',
  background: '#111827',
  surface: '#1F2937',
  text: '#F3F4F6',
  border: '#374151',
  themeColors: [
    '#F3F4F6',
    '#60A5FA',
    '#22D3EE',
    '#34D399',
    '#FBBF24',
    '#FB923C',
    '#F87171',
    '#F472B6',
    '#A78BFA',
    '#9CA3AF',
  ],
};

/** Глобальные темы, которые создаёт сид. */
export const PRESET_THEMES = [
  { name: 'Классическая', colors: DEFAULT_THEME_COLORS },
  { name: 'Тёмная', colors: DARK_THEME_COLORS },
];

/** Поля темы, которые отдаём клиенту. */
export const THEME_SELECT = {
  id: true,
  name: true,
  colors: true,
  isGlobal: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** HEX-цвет в формате #RRGGBB (короткая запись раскрывается) или null. */
export function normalizeHex(value) {
  const text = String(value ?? '').trim();

  if (!HEX_RE.test(text)) return null;

  const hex = text.slice(1);
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  return `#${full.toUpperCase()}`;
}

/** Название темы: обрезаем пробелы и ограничиваем длину. */
export function themeNameField(value) {
  return String(value ?? '').trim().slice(0, THEME_LIMITS.name);
}

/**
 * Нормализует цвета темы из запроса.
 * Возвращает { ok: true, colors } | { ok: false, field, message }.
 */
export function normalizeThemeColors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, field: 'colors', message: 'Цвета темы: ожидается объект с ролями и палитрой' };
  }

  const colors = {};

  for (const key of THEME_COLOR_KEYS) {
    const hex = normalizeHex(input[key]);
    if (!hex) {
      return { ok: false, field: 'colors', message: `Цвет «${THEME_COLOR_LABELS[key]}»: ожидается HEX вида #AABBCC` };
    }
    colors[key] = hex;
  }

  const palette = Array.isArray(input.themeColors) ? input.themeColors : null;

  if (!palette || palette.length !== THEME_PALETTE_SIZE) {
    return { ok: false, field: 'colors', message: `Палитра: нужно ровно ${THEME_PALETTE_SIZE} цветов` };
  }

  colors.themeColors = [];

  for (const [index, item] of palette.entries()) {
    const hex = normalizeHex(item);
    if (!hex) {
      return { ok: false, field: 'colors', message: `Палитра, цвет ${index + 1}: ожидается HEX вида #AABBCC` };
    }
    colors.themeColors.push(hex);
  }

  return { ok: true, colors };
}

/**
 * Публичное представление темы с правами текущего пользователя.
 * canDelete для глобальной темы учитывает, что последнюю глобальную удалять нельзя.
 */
export function presentTheme(theme, { userId, role, activeThemeId, globalCount }) {
  const isAdmin = role === 'admin';
  const isOwn = Boolean(userId) && theme.ownerId === userId;

  return {
    id: theme.id,
    name: theme.name,
    colors: theme.colors,
    isGlobal: theme.isGlobal,
    ownerId: theme.ownerId,
    isOwn,
    isActive: theme.id === activeThemeId,
    canEdit: isOwn || isAdmin,
    canDelete: isOwn || (isAdmin && (!theme.isGlobal || globalCount > 1)),
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  };
}
