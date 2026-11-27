import { useMemo, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import ContentGrid from '../content/ContentGrid.jsx';
import useAutoSave, { SAVE_STATUS_LABELS } from '../content/useAutoSave.js';
import {
  CONTENT_BODY_VERSION,
  contentBodyContents,
  createBodyContent,
  normalizeContentBody,
} from '../../utils/contentBody.js';

/**
 * Карточка термина: название и содержимое определения.
 *
 * Определение — не одно текстовое поле, а набор фрагментов (текст, картинка,
 * видео, таблица, важное, код, диалог, чек-лист): та же сетка, что у слайда
 * теории. Текст редактируется полным редактором, а общая панель инструментов
 * блока применяет команды к тому полю, где стоит курсор.
 */
export default function TermCard({
  term,
  canEdit,
  onSave,
  onDelete,
  onLinkClick,
  highlighted = false,
  checklistBlockId = null,
}) {
  const [draft, setDraft] = useState(() => ({
    term: term.term ?? '',
    body: normalizeContentBody(term.definition, term.id),
  }));
  const [error, setError] = useState(null);

  const { status, queue } = useAutoSave((patch) => onSave(term.id, patch));

  // В просмотре берём данные из стора: после автосохранения там уже новое тело
  const viewContents = useMemo(() => contentBodyContents(term.definition, term.id), [term.definition, term.id]);
  const contents = canEdit ? draft.body.contents : viewContents;

  /** Сохраняет тело карточки и ставит его в очередь автосохранения. */
  const applyBody = (nextContents, title = draft.term) => {
    const value = title.trim();
    const body = { version: CONTENT_BODY_VERSION, contents: nextContents };
    const next = { term: title, body };

    setDraft(next);

    if (!value) {
      setError('Термин не может быть пустым');
      return;
    }

    setError(null);
    queue({ term: value, definition: body });
  };

  const applyTerm = (value) => applyBody(draft.body.contents, value);

  const handleAddContent = (type, index) => {
    const fragment = createBodyContent(type);
    const next = [...draft.body.contents];
    next.splice(index ?? next.length, 0, fragment);
    applyBody(next);
  };

  const handleSaveContent = (contentId, data) => {
    applyBody(draft.body.contents.map((item) => (item.id === contentId ? { ...item, data } : item)));
  };

  const handleWidthChange = (contentId, width) => {
    applyBody(draft.body.contents.map((item) => (item.id === contentId ? { ...item, width } : item)));
  };

  const handleDeleteContent = (contentId) => {
    applyBody(draft.body.contents.filter((item) => item.id !== contentId));
  };

  const handleReorder = (orderedIds) => {
    const byId = new Map(draft.body.contents.map((item) => [item.id, item]));
    applyBody(orderedIds.map((id) => byId.get(id)).filter(Boolean));
  };

  if (!canEdit) {
    return (
      <article
        className={`term-card term-card--view${highlighted ? ' is-link-target' : ''}`}
        data-term-id={term.id}
      >
        <h3 className="term-card__title">{term.term}</h3>
        <ContentGrid
          contents={viewContents}
          canEdit={false}
          checklistBlockId={checklistBlockId}
          onLinkClick={onLinkClick}
        />
      </article>
    );
  }

  return (
    <article className={`term-card${highlighted ? ' is-link-target' : ''}`} data-term-id={term.id}>
      <header className="term-card__head">
        <input
          className="input term-card__input"
          value={draft.term}
          placeholder="Термин"
          aria-label="Термин"
          onChange={(event) => applyTerm(event.target.value)}
        />

        <span className={`content-editor__status content-editor__status--${status}`} role="status">
          {SAVE_STATUS_LABELS[status]}
        </span>

        <button type="button" className="icon-btn icon-btn--danger" aria-label="Удалить термин" onClick={onDelete}>
          <Icon name="trash" size={14} />
        </button>
      </header>

      {error && (
        <span className="content-field__error" role="alert">
          {error}
        </span>
      )}

      <div className="term-card__body">
        <ContentGrid
          contents={contents}
          canEdit
          checklistBlockId={checklistBlockId}
          emptyTitle="Определение пока пустое"
          emptyHint="Добавьте текст, картинку, видео, таблицу, важное, код, диалог или чек-лист."
          onAddContent={handleAddContent}
          onSaveContent={handleSaveContent}
          onDeleteContent={handleDeleteContent}
          onWidthChange={handleWidthChange}
          onReorder={handleReorder}
          onLinkClick={onLinkClick}
        />
      </div>
    </article>
  );
}
