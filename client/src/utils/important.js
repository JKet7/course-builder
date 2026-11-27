/**
 * Блок «Важное»: оформление цветного блока с рамкой (как alert, но без иконки
 * и кнопки закрытия — внутри только текст).
 *
 * Текст «Важного» — Tiptap-документ (`data.type === 'doc'`), поэтому настройки
 * лежат рядом с документом, в ключе `data.important`: Tiptap о нём не знает и
 * не теряет при вводе текста, если сохранять документ через
 * `withImportantStyle` (см. ContentEditor).
 *
 * background — цвет фона ('' — цвет темы `--color-important`),
 * borderColor — цвет рамки ('' — на 18 % темнее фона),
 * borderWidth — 1–2 px, radius — 8–12 px.
 */
import { normalizeHex, relativeLuminance, shadeHex } from './themes.js';

/** Пределы оформления блока (совпадает с server/src/utils/content.js). */
export const IMPORTANT_LIMITS = { borderWidth: [1, 2], radius: [8, 12] };

/** Насколько рамка темнее фона по умолчанию. */
export const IMPORTANT_BORDER_SHADE = 0.18;

/** Оформление по умолчанию: цвета берутся из темы. */
export const IMPORTANT_DEFAULT = { background: '', borderColor: '', borderWidth: 1, radius: 10 };

/**
 * Цвета темы «Классическая» — для color-picker, пока автор не выбрал свой
 * (как DIALOG_COLOR_FALLBACK у диалога).
 */
export const IMPORTANT_THEME_COLORS = { background: '#FDE8F3', border: '#CFBEC7' };

/** Быстрый выбор фона: '' — «как в теме», остальное — пастельные цвета alert-блоков. */
export const IMPORTANT_PALETTE = [
  { value: '', label: 'Как в теме' },
  { value: '#FDE8F3', label: 'Розовый' },
  { value: '#FEF3C7', label: 'Жёлтый' },
  { value: '#FFEDD5', label: 'Оранжевый' },
  { value: '#DCFCE7', label: 'Зелёный' },
  { value: '#DBEAFE', label: 'Голубой' },
  { value: '#EDE9FE', label: 'Фиолетовый' },
  { value: '#E2E8F0', label: 'Серый' },
];

const clampInt = (value, [min, max], fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

/** Оформление блока с заполненными полями по умолчанию и проверенными цветами. */
export function normalizeImportantStyle(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    background: normalizeHex(source.background) ?? '',
    borderColor: normalizeHex(source.borderColor) ?? '',
    borderWidth: clampInt(source.borderWidth, IMPORTANT_LIMITS.borderWidth, IMPORTANT_DEFAULT.borderWidth),
    radius: clampInt(source.radius, IMPORTANT_LIMITS.radius, IMPORTANT_DEFAULT.radius),
  };
}

/** Цвет рамки: выбранный автором или на 18 % темнее фона. */
export function importantBorderColor(value) {
  const style = normalizeImportantStyle(value);
  if (style.borderColor) return style.borderColor;

  return shadeHex(style.background || IMPORTANT_THEME_COLORS.background, -IMPORTANT_BORDER_SHADE);
}

/** Цвет текста под выбранный фон: тёмный на светлом, светлый на тёмном. */
export function importantTextColor(background) {
  return relativeLuminance(background) > 0.5 ? '#1F2937' : '#F3F4F6';
}

/**
 * Инлайн-стили блока для просмотра и печати.
 *
 * Пока автор не выбрал свои цвета, фон и рамку рисует CSS из переменных темы:
 * так блок одинаково выглядит в светлой и тёмной теме. Толщина рамки и
 * скругление попадают в стиль всегда — это настройки самого блока.
 */
export function importantBlockStyle(data) {
  const style = normalizeImportantStyle(data?.important);
  const customBackground = style.background !== '';
  const borderColor = style.borderColor || (customBackground ? importantBorderColor(style) : '');

  return {
    ...(customBackground
      ? { backgroundColor: style.background, color: importantTextColor(style.background) }
      : null),
    ...(borderColor ? { borderColor } : null),
    borderWidth: `${style.borderWidth}px`,
    borderRadius: `${style.radius}px`,
  };
}

/**
 * Документ «Важного» вместе с оформлением.
 * Tiptap отдаёт только { type, content }, поэтому настройки блока нужно
 * приклеить заново при каждом сохранении текста.
 */
export function withImportantStyle(doc, data) {
  const document = doc && doc.type === 'doc' ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };

  return { ...document, important: normalizeImportantStyle(data?.important) };
}
