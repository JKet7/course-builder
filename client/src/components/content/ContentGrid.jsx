import { useEffect, useMemo, useRef, useState } from 'react';
import ContentEditor from './ContentEditor.jsx';
import ContentRenderer from './ContentRenderer.jsx';
import Icon from '../ui/Icon.jsx';
import ToolbarButton from '../editor/toolbar/ToolbarButton.jsx';
import { buildContentRows, contentRowSpans, CONTENT_TYPES, CONTENT_WIDTHS, getContentType } from '../../utils/helpers.js';
import { collectSlideNotes } from '../../utils/notes.js';

/** Меню добавления контента: пустое место и «плюсики». */
export function ContentTypeButtons({ onSelect }) {
  return (
    <div className="content-types">
      {CONTENT_TYPES.map((item) => (
        <button key={item.type} type="button" className="content-types__item" onClick={() => onSelect(item.type)}>
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * «Плюсик» добавления фрагмента вместе с меню типов.
 *
 * Меню держим в состоянии React, а не в нативном `<details>`: после выбора
 * типа фрагмент появляется в сетке, но сам `<details>` оставался открытым
 * («залипал»). Здесь меню закрывается сразу после выбора, а ещё по клику мимо
 * и по Esc.
 */
function ContentAdder({ ariaLabel, className = '', onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`content-plus${open ? ' content-plus--open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="content-plus__trigger"
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" size={16} />
      </button>

      {/* Панель всегда в разметке, но при закрытом меню скрыта: тип контента —
          не «условный» DOM, а просто невидимая панель, как у <details>. */}
      <div className="content-plus__panel" hidden={!open}>
        <ContentTypeButtons
          onSelect={(type) => {
            // Сначала прячем меню: новый фрагмент появится ниже, а меню
            // не должно оставаться открытым поверх сетки.
            setOpen(false);
            onPick(type);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Сетка фрагментов контента: до 3 колонок в ряду (по width), «плюсики» для
 * добавления, перетаскивание и удаление.
 *
 * Одна и та же сетка у слайда теории, определения термина и текста карточки
 * памятки — поэтому компонент не знает, где он стоит: данные и обработчики
 * приходят сверху (SlideGrid, TermCard, MemoSlide).
 *
 * Ряд — сетка из 12 колонок (см. contentRowSpans): 33 % = 4 колонки, поэтому
 * три блока по 33 % стоят в одной строке, а «плюсик» живёт в отступе справа.
 *
 * «Плюсик» есть только у ряда, за которым идёт продолжение (вставка «после этого
 * ряда»), и один нижний — он вставляет фрагмент в конец, то есть в новый ряд.
 */
export default function ContentGrid({
  contents = [],
  canEdit = false,
  highlightContentId = null,
  checklistBlockId = null,
  noteOffset = 0,
  emptyTitle = 'Здесь пусто',
  emptyHint = 'Добавьте первый фрагмент — текст, картинку, видео, таблицу, важное, код, диалог или чек-лист.',
  emptyViewHint = null,
  onAddContent,
  onSaveContent,
  onDeleteContent,
  onWidthChange,
  onReorder,
  onActivateEditor,
  onLinkClick,
}) {
  const [draggingId, setDraggingId] = useState(null);

  // Строки + колонки сетки каждого блока (33 % → 4 колонки из 12)
  const rows = useMemo(
    () => buildContentRows(contents).map((row) => ({ ...row, spans: contentRowSpans(row.items) })),
    [contents],
  );

  // Примечания нумеруются сквозняком по карточке: фрагмент получает смещение.
  // noteOffset — примечания в заголовке карточки памятки перед её содержимым.
  const noteOffsets = useMemo(
    () => collectSlideNotes(contents, noteOffset).offsetById,
    [contents, noteOffset],
  );

  const handleDrop = (targetId) => {
    if (!draggingId || draggingId === targetId) return;

    const ids = contents.map((content) => content.id).filter((id) => id !== draggingId);
    const targetIndex = ids.indexOf(targetId);
    ids.splice(targetIndex === -1 ? ids.length : targetIndex, 0, draggingId);

    onReorder?.(ids);
    setDraggingId(null);
  };

  if (contents.length === 0) {
    // В просмотре пустая карточка ничего не занимает, если подсказка не задана
    if (!canEdit && !emptyViewHint) return null;

    return (
      <div className="slide-empty">
        {canEdit ? (
          <>
            <p className="slide-empty__title">{emptyTitle}</p>
            <p className="slide-empty__hint">{emptyHint}</p>
            <ContentTypeButtons onSelect={(type) => onAddContent?.(type, 0)} />
          </>
        ) : (
          <p className="slide-empty__hint">{emptyViewHint}</p>
        )}
      </div>
    );
  }

  let offset = 0;

  return (
    <div className="slide-grid">
      {rows.map((row, rowIndex) => {
        const rowItems = row.items;
        const insertIndex = offset + rowItems.length;
        offset = insertIndex;

        // «Плюсик» ряда вставляет фрагмент сразу после этого ряда. У последнего
        // ряда это то же самое, что нижний «плюсик» (добавление в конец), поэтому
        // своего «плюсика» он не получает: два одинаковых значка внизу путали —
        // особенно в карточках памятки и глоссария, где он стоит под содержимым.
        const withAdder = canEdit && rowIndex < rows.length - 1;

        return (
          <div
            className={['slide-row', canEdit ? 'slide-row--edit' : '', withAdder ? 'slide-row--add' : '']
              .filter(Boolean)
              .join(' ')}
            key={rowItems.map((item) => item.id).join('-')}
          >
            {rowItems.map((content, index) => (
              <ContentCard
                key={content.id}
                content={content}
                span={row.spans[index]}
                canEdit={canEdit}
                highlighted={highlightContentId === content.id}
                dragging={draggingId === content.id}
                onDragStart={() => setDraggingId(content.id)}
                onDragEnd={() => setDraggingId(null)}
                onDrop={() => handleDrop(content.id)}
                noteOffset={noteOffsets.get(content.id) ?? 0}
                onSaveContent={onSaveContent}
                onDeleteContent={onDeleteContent}
                onWidthChange={onWidthChange}
                onActivateEditor={onActivateEditor}
                onLinkClick={onLinkClick}
                checklistBlockId={checklistBlockId}
              />
            ))}

            {withAdder && (
              <ContentAdder
                ariaLabel="Добавить фрагмент в этот ряд"
                onPick={(type) => onAddContent?.(type, insertIndex)}
              />
            )}
          </div>
        );
      })}

      {canEdit && (
        <ContentAdder
          className="content-plus--row"
          ariaLabel="Добавить фрагмент в новый ряд"
          onPick={(type) => onAddContent?.(type, contents.length)}
        />
      )}
    </div>
  );
}

/** Карточка одного фрагмента контента. */
function ContentCard({
  content,
  span = 12,
  canEdit,
  highlighted = false,
  dragging,
  noteOffset = 0,
  onDragStart,
  onDragEnd,
  onDrop,
  onSaveContent,
  onDeleteContent,
  onWidthChange,
  onActivateEditor,
  onLinkClick,
  checklistBlockId = null,
}) {
  const meta = getContentType(content.type);
  // Ширину колонки видео задаёт автор в шапке карточки (span ряда), а align
  // выравнивает содержимое внутри этой колонки — карточка из ряда не уезжает.
  const videoAlign = content.type === 'video' ? (content.data?.align ?? 'center') : null;

  // Ширина автора (33 / 50 / 66 / 100 %) — это число колонок сетки ряда (span).
  return (
    <article
      className={[
        'content-card',
        // Правка 9: в просмотре карточка только раскладывает контент —
        // без рамки, фона и шапки с типом (стили в content-card--view).
        canEdit ? '' : 'content-card--view',
        dragging ? 'is-dragging' : '',
        content.type === 'video' ? 'content-card--video' : '',
        highlighted ? 'content-card--found' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-content-id={content.id}
      data-align={videoAlign ?? undefined}
      style={{ gridColumn: `span ${span}` }}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (canEdit) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      {/* В просмотре шапки нет: тип контента — служебная подпись (Правка 9) */}
      {canEdit && (
        <header className="content-card__head">
          <span className="content-card__type">
            <Icon name="grip" size={14} className="content-card__grip" />
            <Icon name={meta.icon} size={14} />
            {meta.label}
          </span>

          <div className="content-card__actions">
            <label className="content-card__width">
              <span className="visually-hidden">Ширина колонки</span>
              <select
                className="tool-select tool-select--sm"
                value={content.width}
                onChange={(event) => onWidthChange?.(content.id, Number(event.target.value))}
              >
                {CONTENT_WIDTHS.map((width) => (
                  <option key={width} value={width}>
                    {width}%
                  </option>
                ))}
              </select>
            </label>

            <ToolbarButton
              icon="trash"
              label="Удалить фрагмент"
              className="tool-btn--danger"
              onClick={() => onDeleteContent?.(content.id)}
            />
          </div>
        </header>
      )}

      <div className="content-card__body">
        {canEdit ? (
          <ContentEditor
            content={content}
            noteOffset={noteOffset}
            onSave={(data) => onSaveContent?.(content.id, data)}
            onActivate={onActivateEditor}
          />
        ) : (
          <ContentRenderer
            content={content}
            noteOffset={noteOffset}
            onLinkClick={onLinkClick}
            checklistBlockId={checklistBlockId}
          />
        )}
      </div>
    </article>
  );
}
