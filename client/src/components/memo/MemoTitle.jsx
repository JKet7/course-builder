import { DocContent } from '../content/ContentRenderer.jsx';
import { docToText, textToDoc } from '../../utils/helpers.js';

/** Похоже ли значение на Tiptap-документ. */
const isDoc = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.type === 'doc';

/**
 * Документ заголовка карточки памятки.
 * Новые карточки хранят titleDoc, старые — только простой title: его
 * показываем через тот же Tiptap-рендер, чтобы оформление было единым.
 */
export function memoTitleDoc(title, titleDoc) {
  if (isDoc(titleDoc) && docToText(titleDoc)) return titleDoc;
  return textToDoc(title ?? '');
}

/**
 * Заголовок карточки в просмотре и печати.
 * Форматирование (жирный, курсив, ссылки, выравнивание) сохраняется;
 * пустой заголовок заменяется подсказкой.
 */
export default function MemoTitle({
  title,
  titleDoc,
  className = 'memo-card__title',
  fallback = 'Без названия',
  onLinkClick,
}) {
  const formatted = isDoc(titleDoc) && docToText(titleDoc) ? titleDoc : null;
  const plain = String(title ?? '').trim();
  const doc = formatted ?? (plain ? textToDoc(plain) : null);

  if (!doc) return <div className={className}>{fallback}</div>;

  return (
    <div className={className}>
      <DocContent doc={doc} onLinkClick={onLinkClick} />
    </div>
  );
}