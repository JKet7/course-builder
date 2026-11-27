import { useEffect, useRef, useState } from 'react';
import Button from '../../ui/Button.jsx';
import { NOTE_MAX_LENGTH } from '../../../utils/notes.js';

/**
 * Всплывающее поле примечания (Правка 5).
 *
 * Появляется над выделенным словом, как в Wiki: автор вводит короткое предложение
 * и сохраняет его. В режиме редактирования здесь же кнопка «✕ Удалить».
 * anchor — { top, left } в координатах окна (position: fixed).
 */
export default function NotePopover({
  mode = 'create',
  initialText = '',
  anchor = null,
  onSave,
  onDelete,
  onClose,
}) {
  const [text, setText] = useState(initialText);
  const rootRef = useRef(null);
  const areaRef = useRef(null);

  useEffect(() => {
    areaRef.current?.focus();
    areaRef.current?.select();
  }, []);

  useEffect(() => {
    const handlePointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) onClose();
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const trimmed = text.trim();
  const isEdit = mode === 'edit';

  const submit = () => {
    if (trimmed) onSave(text);
  };

  return (
    <div
      className="note-popover"
      ref={rootRef}
      role="dialog"
      aria-label={isEdit ? 'Примечание к тексту' : 'Новое примечание к тексту'}
      style={anchor ? { top: `${anchor.top}px`, left: `${anchor.left}px` } : undefined}
    >
      <label className="note-popover__label" htmlFor="note-popover-text">
        {isEdit ? 'Примечание' : 'Новое примечание'}
      </label>

      <textarea
        id="note-popover-text"
        ref={areaRef}
        className="note-popover__text"
        rows={3}
        maxLength={NOTE_MAX_LENGTH}
        value={text}
        placeholder="Короткое пояснение к слову…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />

      <div className="note-popover__meta">
        <span>Ctrl+Enter — сохранить, Esc — отмена</span>
        <span className="note-popover__count">
          {text.length}/{NOTE_MAX_LENGTH}
        </span>
      </div>

      <div className="note-popover__actions">
        {isEdit && (
          <Button size="sm" variant="ghost" className="note-popover__delete" onClick={onDelete}>
            ✕ Удалить
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button size="sm" disabled={!trimmed} onClick={submit}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
