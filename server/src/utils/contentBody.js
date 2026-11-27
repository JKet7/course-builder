/**
 * Тело карточки «Глоссарий» и «Памятка»: набор фрагментов контента, тот же,
 * что у слайда теории (текст, картинка, видео, таблица, важное, код, диалог,
 * чек-лист).
 *
 * Формат: { version: 2, contents: [{ id, type, width, data }] }.
 * Старые записи (один Tiptap-документ в GlossaryTerm.definition / MemoCell.body)
 * принимаются и превращаются в тело из одного текстового фрагмента, поэтому
 * миграция БД не нужна: поле Json хранит обе формы.
 */
import { CONTENT_TYPES, CONTENT_WIDTHS, normalizeContentData } from './content.js';
import { docFromInput, isTiptapDoc } from './tiptap.js';

/** Версия формата тела карточки (совпадает с client/src/utils/contentBody.js). */
export const CONTENT_BODY_VERSION = 2;

/** Сколько фрагментов допускаем в одной карточке. */
export const CONTENT_BODY_LIMIT = 60;

/** Похоже ли значение на тело карточки нового формата. */
export const isContentBody = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Number(value.version) === CONTENT_BODY_VERSION &&
  Array.isArray(value.contents);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Идентификатор фрагмента: клиентский или сгенерированный сервером. */
const fragmentId = (value, index) => {
  const id = typeof value === 'string' ? value.trim() : '';
  return ID_PATTERN.test(id) ? id : `fragment-${index + 1}`;
};

/** Пустой Tiptap-документ (ни одного непустого узла) — это ещё не контент. */
function isEmptyDoc(doc) {
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  return nodes.every((node) => {
    if (!node || typeof node !== 'object') return true;
    if (node.type !== 'paragraph') return false;
    return !node.content || node.content.length === 0;
  });
}

const emptyBody = () => ({ version: CONTENT_BODY_VERSION, contents: [] });

/**
 * Тело карточки в актуальном формате.
 * Возвращает { ok: true, body } либо { ok: false, message }.
 */
export function normalizeContentBody(value) {
  if (value === undefined || value === null) {
    return { ok: true, body: emptyBody() };
  }

  if (isContentBody(value)) {
    if (value.contents.length > CONTENT_BODY_LIMIT) {
      return { ok: false, message: `не более ${CONTENT_BODY_LIMIT} фрагментов` };
    }

    const contents = [];

    for (const [index, item] of value.contents.entries()) {
      const label = `фрагмент ${index + 1}`;

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, message: `${label}: ожидается объект` };
      }

      if (!CONTENT_TYPES.includes(item.type)) {
        return { ok: false, message: `${label}: тип — допустимые значения ${CONTENT_TYPES.join(', ')}` };
      }

      if (item.width !== undefined && !CONTENT_WIDTHS.includes(item.width)) {
        return { ok: false, message: `${label}: ширина — допустимые значения ${CONTENT_WIDTHS.join(', ')}` };
      }

      const data = normalizeContentData(item.type, item.data);
      if (!data.ok) return { ok: false, message: `${label}: ${data.message}` };

      contents.push({
        id: fragmentId(item.id, index),
        type: item.type,
        width: item.width ?? 100,
        data: data.data,
      });
    }

    return { ok: true, body: { version: CONTENT_BODY_VERSION, contents } };
  }

  // Старый формат: один Tiptap-документ (или строка из CSV)
  const doc = docFromInput(value);
  if (!doc.ok) return { ok: false, message: doc.message };

  if (isEmptyDoc(doc.doc)) return { ok: true, body: emptyBody() };

  return {
    ok: true,
    body: {
      version: CONTENT_BODY_VERSION,
      contents: [{ id: 'text-1', type: 'text', width: 100, data: doc.doc }],
    },
  };
}

/**
 * Фрагменты карточки для обхода примечаний и ссылок (help.js).
 * Понимает и новый формат, и старый Tiptap-документ.
 */
export function contentBodyItems(value) {
  if (isContentBody(value)) return value.contents.filter((item) => item && typeof item === 'object');

  if (isTiptapDoc(value)) {
    return isEmptyDoc(value) ? [] : [{ id: 'text-1', type: 'text', width: 100, data: value }];
  }

  return [];
}
