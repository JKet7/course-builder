import { useCallback, useEffect, useState } from 'react';
import NotePopover from './NotePopover.jsx';
import ToolbarButton from './ToolbarButton.jsx';
import { useNoteStore } from '../../../store/noteStore.js';
import {
  findInlineNote,
  getNoteAtSelection,
  insertInlineNote,
  removeInlineNote,
  updateInlineNote,
} from '../extensions/inlineNote.js';

/** Куда повесить поле примечания: над выделением, по его центру. */
function anchorFor(editor, from, to) {
  const width = 320;
  const viewport = typeof window !== 'undefined' ? window.innerWidth || width + 24 : width + 24;
  const fallback = { top: Math.min(200, viewport), left: viewport / 2 };

  if (!editor || editor.isDestroyed) return fallback;

  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(Math.max(from, to));
    const center = (start.left + (end.right ?? start.left)) / 2;
    const minLeft = width / 2 + 12;
    const maxLeft = Math.max(minLeft, viewport - width / 2 - 12);

    return {
      // Поле раскрывается вверх (transform: translate(-50%, -100%)), поэтому
      // у верхнего края экрана сдвигаем его ниже, чтобы оно не ушло за границу
      top: Math.max(start.top, 200),
      left: Math.min(Math.max(center, minLeft), maxLeft),
    };
  } catch {
    return fallback;
  }
}

/**
 * Группа «Примечание» (Правка 5).
 *
 * Кнопка на панели и Ctrl+Alt+M открывают поле над выделенным словом; клик по слову
 * с примечанием или по его номеру — то же поле с готовым текстом и кнопкой «Удалить».
 * Номер примечания рисует плагин декораций, поэтому нумерация пересчитывается сама.
 *
 * Если выделение — в обычном поле (ячейка таблицы, пункт чек-листа, подпись),
 * кнопка работает с ним: такое поле сообщает о себе через noteStore.
 */
export default function NoteGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;
  const [popover, setPopover] = useState(null);
  const noteTarget = useNoteStore((state) => state.target);

  const activeNote = ready && editor.isFocused ? getNoteAtSelection(editor) : null;
  // Выделение в Tiptap действует, только пока в нём стоит курсор: иначе кнопка
  // работала бы со старым выделением текста, хотя пользователь уже в таблице.
  const hasSelection = Boolean(activeNote) || (ready && editor.isFocused && !editor.state.selection.empty);
  const plainTarget = ready && editor.isFocused ? null : noteTarget;

  const openCreate = useCallback(() => {
    if (hasSelection && editor && !editor.isDestroyed) {
      const { from, to } = editor.state.selection;
      setPopover({ mode: 'create', noteId: null, text: '', anchor: anchorFor(editor, from, to) });
      return;
    }

    if (!plainTarget) return;
    setPopover({
      mode: 'create',
      noteId: null,
      text: '',
      anchor: plainTarget.anchor,
      create: plainTarget.create,
    });
  }, [editor, hasSelection, plainTarget]);

  const openEdit = useCallback(
    (noteId) => {
      const note = findInlineNote(editor, noteId);
      if (!note) return;

      setPopover({
        mode: 'edit',
        noteId,
        text: note.text,
        anchor: anchorFor(editor, note.from, note.to),
      });
    },
    [editor],
  );

  // Ctrl+Alt+M приходит событием редактора, клик — прямо из DOM редактора
  useEffect(() => {
    if (!ready || !editor) return undefined;

    const dom = editor.view?.dom;
    const handleRequest = () => openCreate();
    const handleClick = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;

      const element = target.closest('[data-note-id]');
      const noteId = element?.getAttribute('data-note-id');
      if (!noteId) return;

      event.preventDefault();
      openEdit(noteId);
    };

    editor.on('inline-note:request', handleRequest);
    dom?.addEventListener('click', handleClick);

    return () => {
      editor.off('inline-note:request', handleRequest);
      dom?.removeEventListener('click', handleClick);
    };
  }, [editor, ready, openCreate, openEdit]);

  const close = () => setPopover(null);

  const handleSave = (text) => {
    if (typeof popover?.create === 'function') {
      if (popover.create(text)) close();
      return;
    }

    const saved =
      popover?.mode === 'edit'
        ? updateInlineNote(editor, popover.noteId, text)
        : insertInlineNote(editor, text);

    if (saved) close();
  };

  const handleDelete = () => {
    if (popover?.noteId && removeInlineNote(editor, popover.noteId)) close();
  };

  const canCreate = Boolean(activeNote) || hasSelection || Boolean(plainTarget);

  return (
    <>
      <ToolbarButton
        icon="note"
        label="Примечание"
        hint="Ctrl+Alt+M"
        active={Boolean(activeNote)}
        disabled={!canCreate}
        onClick={() => (activeNote ? openEdit(activeNote.noteId) : openCreate())}
      />

      {popover && (
        <NotePopover
          key={`${popover.mode}-${popover.noteId ?? 'new'}-${popover.anchor?.top ?? 0}`}
          mode={popover.mode}
          initialText={popover.text}
          anchor={popover.anchor}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={close}
        />
      )}
    </>
  );
}
