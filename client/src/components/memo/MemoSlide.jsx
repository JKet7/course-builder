import { useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import MemoCard from './MemoCard.jsx';
import useAutoSave, { SAVE_STATUS_LABELS } from '../content/useAutoSave.js';

/**
 * Слайд памятки: заголовок и сетка карточек.
 *
 * Внутри слайда карточки идут сеткой, как раньше; на экране виден только
 * активный слайд, остальные открываются из содержания. Заголовок слайда
 * сохраняется автосохранением, карточки — каждая сама.
 */
export default function MemoSlide({
  slide,
  index,
  canEdit,
  onSaveSlide,
  onAddCard,
  onSaveCell,
  onDeleteCell,
  onMoveCell,
  onLinkClick,
  highlighted = false,
  highlightContentId = null,
  linkedCellId = null,
  checklistBlockId = null,
}) {
  const [draft, setDraft] = useState(slide.title ?? '');
  const [error, setError] = useState(null);

  const { status, queue } = useAutoSave((patch) => onSaveSlide(slide.id, patch));

  const applyTitle = (value) => {
    setDraft(value);
    const title = value.trim();

    if (!title) {
      setError('Заголовок не может быть пустым');
      return;
    }

    setError(null);
    queue({ title });
  };

  return (
    <article
      className={`memo-slide${highlighted ? ' is-link-target' : ''}`}
      data-memo-slide-id={slide.id}
    >
      <header className="slide-head memo-slide__head">
        <span className="slide-head__index">Слайд {index + 1}</span>

        {canEdit ? (
          <>
            <input
              className="input slide-head__title"
              value={draft}
              placeholder="Название слайда"
              aria-label="Название слайда"
              onChange={(event) => applyTitle(event.target.value)}
            />
            <span className={`content-editor__status content-editor__status--${status}`} role="status">
              {SAVE_STATUS_LABELS[status]}
            </span>
          </>
        ) : (
          <h2 className="slide-head__title">{slide.title || `Слайд ${index + 1}`}</h2>
        )}
      </header>

      <hr className="memo-slide__divider" />

      {error && (
        <span className="content-field__error" role="alert">
          {error}
        </span>
      )}

      {slide.cells.length > 0 ? (
        <div className="memo-grid">
          {slide.cells.map((cell, cellIndex) => (
            <MemoCard
              key={cell.id}
              cell={cell}
              canEdit={canEdit}
              onSave={onSaveCell}
              onDelete={onDeleteCell}
              onMove={(cellId, delta) => onMoveCell(slide.id, cellId, delta)}
              canMoveLeft={cellIndex > 0}
              canMoveRight={cellIndex < slide.cells.length - 1}
              onLinkClick={onLinkClick}
              highlighted={linkedCellId === cell.id || highlightContentId === cell.id}
              highlightContentId={highlightContentId}
              checklistBlockId={checklistBlockId}
            />
          ))}
        </div>
      ) : (
        <div className="memo-slide__empty">
          <p className="memo-slide__empty-title">На слайде пока нет карточек</p>
          <p className="memo-slide__empty-hint">Добавьте карточку — она появится в сетке этого слайда.</p>
        </div>
      )}

      {canEdit && (
        <div className="memo-slide__actions">
          <Button variant="ghost" size="sm" onClick={onAddCard} title="Добавить карточку">
            <Icon name="plus" size={16} />
            Добавить карточку
          </Button>
        </div>
      )}
    </article>
  );
}
