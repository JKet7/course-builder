/**
 * Темы оформления (Шаг 12): HEX-нормализация, CSS-переменные и валидация черновика.
 *
 * Значения по умолчанию дублируют server/src/utils/theme.js: до загрузки GET /api/themes
 * интерфейс показывает «Классическую» тему из styles/themes.css.
 */

/** Роли цвета темы — по одной на CSS-переменную. */
export const THEME_COLOR_KEYS = ['accent', 'muted', 'background', 'surface', 'text', 'border'];

/** Длина палитры «Цвета темы» (тулбар редактора). */
export const PALETTE_SIZE = 10;

/** Ограничения полей темы (совпадают с сервером). */
export const THEME_LIMITS = { name: 60 };

/** Поля формы редактора тем. */
export const THEME_FIELDS = [
  { key: 'accent', label: 'Акцент', hint: 'Кнопки, ссылки, активные элементы' },
  { key: 'muted', label: 'Приглушённый текст', hint: 'Подписи и второстепенный текст' },
  { key: 'background', label: 'Фон страницы', hint: 'Общий фон приложения' },
  { key: 'surface', label: 'Поверхность', hint: 'Карточки, панели, модалки' },
  { key: 'text', label: 'Основной текст', hint: 'Заголовки и абзацы' },
  { key: 'border', label: 'Границы', hint: 'Рамки полей и карточек' },
];

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

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** HEX-цвет в формате #RRGGBB (короткая запись раскрывается) или null. */
export function normalizeHex(value) {
  const text = String(value ?? '').trim();

  if (!HEX_RE.test(text)) return null;

  const hex = text.slice(1);
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  return `#${full.toUpperCase()}`;
}

/** #RRGGBB → { r, g, b } (0–255). */
export function hexToRgb(value) {
  const hex = normalizeHex(value) ?? DEFAULT_THEME_COLORS.text;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const channel = (number) => Math.max(0, Math.min(255, Math.round(number))).toString(16).padStart(2, '0');

/** { r, g, b } → #RRGGBB */
export function rgbToHex({ r, g, b }) {
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Смешивает два цвета: ratio — доля второго цвета (0…1). */
export function mixHex(from, to, ratio = 0.5) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const part = Math.max(0, Math.min(1, ratio));

  return rgbToHex({
    r: a.r + (b.r - a.r) * part,
    g: a.g + (b.g - a.g) * part,
    b: a.b + (b.b - a.b) * part,
  });
}

/** Осветляет (amount > 0) или затемняет (amount < 0) цвет. */
export function shadeHex(value, amount) {
  return amount < 0 ? mixHex(value, '#000000', -amount) : mixHex(value, '#FFFFFF', amount);
}

/** Относительная яркость по WCAG 2.1. */
export function relativeLuminance(value) {
  const { r, g, b } = hexToRgb(value);
  const parts = [r, g, b].map((item) => {
    const srgb = item / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Цвет текста на фоне: белый или почти чёрный — что контрастнее. */
export function contrastText(background) {
  const backgroundLum = relativeLuminance(background);
  const white = contrastRatio(backgroundLum, 1);
  const black = contrastRatio(backgroundLum, relativeLuminance('#1B1B16'));

  return white >= black ? '#FFFFFF' : '#1B1B16';
}

/**
 * CSS-переменные темы. Значения подставляются инлайном в <html>,
 * поэтому перекрывают :root из themes.css.
 */
export function themeVariables(colors) {
  const accent = normalizeHex(colors?.accent) ?? DEFAULT_THEME_COLORS.accent;
  const muted = normalizeHex(colors?.muted) ?? DEFAULT_THEME_COLORS.muted;
  const background = normalizeHex(colors?.background) ?? DEFAULT_THEME_COLORS.background;
  const surface = normalizeHex(colors?.surface) ?? DEFAULT_THEME_COLORS.surface;
  const text = normalizeHex(colors?.text) ?? DEFAULT_THEME_COLORS.text;
  const border = normalizeHex(colors?.border) ?? DEFAULT_THEME_COLORS.border;

  return {
    '--color-primary': accent,
    '--color-primary-hover': shadeHex(accent, -0.12),
    '--color-primary-text': contrastText(accent),
    '--color-bg': background,
    '--color-surface': surface,
    '--color-surface-alt': mixHex(surface, text, 0.07),
    '--color-border': border,
    '--color-text': text,
    '--color-text-muted': muted,
  };
}

/** Применяет тему к <html> (по умолчанию — к документу браузера). */
export function applyTheme(colors, root = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root) return null;

  const variables = themeVariables(colors);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }

  return variables;
}

/** Возвращает оформление к значениям по умолчанию из themes.css. */
export function resetTheme(root = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root) return;

  for (const name of Object.keys(themeVariables(DEFAULT_THEME_COLORS))) {
    root.style.removeProperty(name);
  }
}

/** Черновик формы из темы сервера (или из значений по умолчанию). */
export function draftFromTheme(theme) {
  const source = theme?.colors && typeof theme.colors === 'object' ? theme.colors : DEFAULT_THEME_COLORS;
  const colors = {};

  for (const field of THEME_FIELDS) {
    colors[field.key] = normalizeHex(source[field.key]) ?? DEFAULT_THEME_COLORS[field.key];
  }

  const palette = Array.isArray(source.themeColors) ? source.themeColors : DEFAULT_THEME_COLORS.themeColors;
  colors.themeColors = Array.from(
    { length: PALETTE_SIZE },
    (_, index) => normalizeHex(palette[index]) ?? DEFAULT_THEME_COLORS.themeColors[index],
  );

  return {
    name: String(theme?.name ?? ''),
    colors,
    isGlobal: Boolean(theme?.isGlobal),
  };
}

/** Название копии: «Копия — Классическая». */
export function copyThemeName(name) {
  return `Копия — ${String(name ?? '').trim()}`.slice(0, THEME_LIMITS.name);
}

/**
 * Проверяет черновик формы: название, 6 ролей и палитра из 10 цветов.
 * Возвращает { ok, errors, name, colors } — colors уже нормализованы.
 */
export function validateThemeDraft(draft) {
  const errors = {};
  const name = String(draft?.name ?? '').trim();

  if (!name) {
    errors.name = 'Название: обязательное поле';
  } else if (name.length > THEME_LIMITS.name) {
    errors.name = `Название: не длиннее ${THEME_LIMITS.name} символов`;
  }

  const source = draft?.colors ?? {};
  const colors = {};

  for (const field of THEME_FIELDS) {
    const hex = normalizeHex(source[field.key]);
    if (hex) {
      colors[field.key] = hex;
    } else {
      errors[`colors.${field.key}`] = `${field.label}: ожидается HEX вида #AABBCC`;
    }
  }

  const palette = Array.isArray(source.themeColors) ? source.themeColors : [];

  if (palette.length !== PALETTE_SIZE) {
    errors['colors.themeColors'] = `Палитра: нужно ровно ${PALETTE_SIZE} цветов`;
  } else {
    colors.themeColors = palette.map((item, index) => {
      const hex = normalizeHex(item);
      if (!hex) {
        errors[`colors.themeColors.${index}`] = `Палитра, цвет ${index + 1}: ожидается HEX вида #AABBCC`;
      }
      return hex ?? String(item ?? '');
    });
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    name: name.slice(0, THEME_LIMITS.name),
    colors,
  };
}
