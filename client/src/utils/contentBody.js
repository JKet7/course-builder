/**
 * Тело карточки «Глоссарий» и «Памятка».
 *
 * Раньше определение термина и текст карточки памятки были одним Tiptap-документом.
 * Теперь карточка — такой же набор фрагментов, как слайд теории: текст, картинка,
 * видео, таблица, важное, код, диалог и чек-лист.
 *
 * Формат: { version: 2, contents: [{ id, type, width, data }] }.
 * Старая запись (один Tiptap-документ в GlossaryTerm.definition / MemoCell.body)
 * читается как тело из одного текстового фрагмента, поэтому данные не теряются
 * и миграция БД не нужна — поле Json допускает обе формы.
 */
import { CONTENT_TYPES, CONTENT_WIDTHS, normalizeContentData } from './helpers.js';
import { getContentSearchFields } from './search.js';

/** Версия формата тела карточки (совпадает с server/src/utils/contentBody.js). */
export const CONTENT_BODY_VERSION = 2;

/** Сколько фрагментов допускаем в одной карточке (совпадает с сервером). */
export const CONTENT_BODY_LIMIT = 60;

const CONTENT_TYPE_NAMES = new Set(CONTENT_TYPES.map((item) => item.type));

/** Похоже ли значение на тело карточки нового формата. */
export function isContentBody(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number(value.version) === CONTENT_BODY_VERSION &&
    Array.isArray(value.contents)
  );
}

let fallbackCounter = 0;

/** Идентификатор нового фрагмента карточки. */
export function createContentId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `c-${uuid}`;

  fallbackCounter += 1;
  return `c-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/** Новый фрагмент контента с данными по умолчанию (как у слайда теории). */
export function createBodyContent(type, id = createContentId()) {
  return { id, type, width: 100, data: normalizeContentData(type, null) };
}

/** Фрагмент в нормализованном виде либо null, если тип неизвестен. */
function normalizeFragment(item, index, prefix) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (!CONTENT_TYPE_NAMES.has(item.type)) return null;

  const width = CONTENT_WIDTHS.includes(Number(item.width)) ? Number(item.width) : 100;
  const rawId = typeof item.id === 'string' ? item.id.trim() : '';

  return {
    id: rawId || `${prefix}-c${index + 1}`,
    type: item.type,
    width,
    data: normalizeContentData(item.type, item.data),
  };
}

/**
 * Тело карточки в актуальном формате.
 * prefix — стабильная часть идентификаторов фрагментов без id (id карточки):
 * перерисовка не должна менять ключи списка.
 */
export function normalizeContentBody(value, prefix = 'card') {
  if (isContentBody(value)) {
    const contents = value.contents
      .slice(0, CONTENT_BODY_LIMIT)
      .map((item, index) => normalizeFragment(item, index, prefix))
      .filter(Boolean);

    return { version: CONTENT_BODY_VERSION, contents };
  }

  // Старый формат: один Tiptap-документ с определением/текстом карточки
  if (value && typeof value === 'object' && value.type === 'doc') {
    return {
      version: CONTENT_BODY_VERSION,
      contents: [{ id: `${prefix}-text`, type: 'text', width: 100, data: value }],
    };
  }

  return { version: CONTENT_BODY_VERSION, contents: [] };
}

/** Фрагменты карточки: у старой записи — один текстовый. */
export function contentBodyContents(value, prefix = 'card') {
  return normalizeContentBody(value, prefix).contents;
}

/**
 * Текст карточки для поиска и превью: у каждого типа свой способ достать строку
 * (см. getContentSearchFields), фрагменты склеиваются через пробел.
 */
export function contentBodyToText(value, prefix = 'card') {
  return contentBodyContents(value, prefix)
    .flatMap((fragment) => getContentSearchFields(fragment).map((field) => field.text))
    .filter(Boolean)
    .join(' ')
    .trim();
}
