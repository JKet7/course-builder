import { useEffect, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import TiptapEditor from '../editor/TiptapEditor.jsx';
import useAutoSave, { SAVE_STATUS_LABELS } from '../content/useAutoSave.js';
import { pluralize } from '../../utils/helpers.js';

/**
 * Карточка раздела ветвления между вопросами.
 * Название — точка, куда ведут переходы вариантов; итоговый комментарий
 * автор пишет для читателя, который закончил путь в этом разделе.
 */
export default function SectionCard({ section, count = 0, onRename, onDelete, onResultChange }) {
  const [title, setTitle] = useState(section.title ?? '');
  const { status, queue } = useAutoSave((result) => onResultChange(section.id, result));

  useEffect(() => {
    setTitle(section.title ?? '');
  }, [section.title]);

  const commit = () => {
    const value = title.trim();
    if (!value || value === section.title) {
      setTitle(section.title ?? '');
      return;
    }

    onRename(section.id, value);
  };

  return (
    <article className="test-section-card">
      <header className="test-section-card__head">
        <span className="test-section-card__icon" aria-hidden="true">
          <Icon name="listTree" size={16} />
        </span>

        <input
          className="input input--sm test-section-card__title"
          value={title}
          aria-label="Название раздела"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') setTitle(section.title ?? '');
          }}
        />

        <span className="badge badge--gray">
          {count} {pluralize(count, ['вопрос', 'вопроса', 'вопросов'])}
        </span>

        <span className={`content-editor__status content-editor__status--${status}`} role="status">
          {SAVE_STATUS_LABELS[status]}
        </span>

        <button
          type="button"
          className="icon-btn icon-btn--danger"
          aria-label={`Удалить раздел «${section.title}»`}
          onClick={() => onDelete(section)}
        >
          <Icon name="trash" size={14} />
        </button>
      </header>

      <label className="content-field test-section-card__result">
        <span className="content-field__label">Итоговый комментарий этого пути</span>
        <TiptapEditor
          value={section.result ?? null}
          placeholder="Что увидит читатель, придя в этот раздел…"
          onChange={(doc) => queue(doc)}
        />
      </label>
    </article>
  );
}
