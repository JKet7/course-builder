import { useEffect, useRef, useState } from 'react';
import NotePopover from '../../editor/toolbar/NotePopover.jsx';
import Icon from '../../ui/Icon.jsx';
import { useLinkStore } from '../../../store/linkStore.js';
import { useNoteStore } from '../../../store/noteStore.js';
import { applyPlainLink, linksForField, removePlainLink } from '../../../utils/links.js';
import {
  addPlainNote,
  createPlainNote,
  notesForField,
  removePlainNote,
  setPlainNoteText,
} from '../../../utils/notes.js';

/** Сквозной счётчик полей: по нему панель инструментов отличает цели. */
let fieldCounter = 0;

/** Куда показать поле примечания: над самим полем ввода. */
function anchorFor(element) {
  const width = 320;
  const viewport = typeof window !== 'undefined' ? window.innerWidth || width + 24 : width + 24;
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return { top: 200, left: viewport / 2 };

  const center = rect.left + rect.width / 2;
  const minLeft = width / 2 + 12;
  const maxLeft = Math.max(minLeft, viewport - width / 2 - 12);

  // Поле раскрывается вверх (transform: translate(-50%, -100%))
  return { top: Math.max(rect.top, 200), left: Math.min(Math.max(center, minLeft), maxLeft) };
}

/**
 * Поле обычного текста с примечаниями (Правка 5) и ссылками (Правка 6).
 *
 * Чек-лист, подписи, код и реплики не используют Tiptap, поэтому
 * примечание хранится рядом с данными (data.notes), а ссылка — в data.links;
 * обе привязаны к выделенному слову: field — имя поля, refId — ячейка
 * «строка-колонка» или id пункта. У таблицы ячейка — Tiptap-документ
 * (editors/CellEditor.jsx), поэтому её аннотации — метки в тексте.
 *
 * Создать примечание можно двумя способами, как в Wiki: выделить слово, нажать
 * кнопку на панели инструментов (или Ctrl+Alt+M) либо нажать иконку у самого
 * поля. Ссылка — Ctrl+K, кнопка панели или иконка звена цепи у поля; иконки
 * уже поставленных ссылок показываются рядом с полем.
 * Номера примечаний — номера слайда (numberById).
 */
export default function RichInput({
  as = 'input',
  value = '',
  notes = [],
  links = [],
  field,
  refId = '',
  numberById,
  onNotesChange,
  onLinksChange,
  onAnnotate,
  className = '',
  ...rest
}) {
  const Control = as === 'textarea' ? 'textarea' : 'input';
  const controlRef = useRef(null);
  const tokenRef = useRef(`plain-field-${(fieldCounter += 1)}`);
  const selectionRef = useRef({ from: 0, to: 0 });
  const [popover, setPopover] = useState(null);

  const setNoteTarget = useNoteStore((state) => state.setTarget);
  const clearNoteTarget = useNoteStore((state) => state.clearTarget);
  const setLinkTarget = useLinkStore((state) => state.setTarget);
  const clearLinkTarget = useLinkStore((state) => state.clearTarget);
  const openLinkDialog = useLinkStore((state) => state.openDialog);

  // Колбэки из панели инструментов читают актуальные данные через ref
  const latest = useRef({ value, notes, links, field, refId, onNotesChange, onLinksChange, onAnnotate });
  latest.current = { value, notes, links, field, refId, onNotesChange, onLinksChange, onAnnotate };

  const { onKeyDown, ...controlProps } = rest;
  const fieldNotes = notesForField(notes, field, refId);
  const fieldLinks = linksForField(links, field, refId);

  const saveNotes = (next) => latest.current.onNotesChange?.(next);

  /** Примечание на текущем выделении (без выделения — на всё поле). */
  const createNote = (rawText) => {
    const current = latest.current;
    const { from, to } = selectionRef.current;
    const note = createPlainNote({
      field: current.field,
      ref: current.refId,
      from,
      to,
      word: current.value.slice(from, to).trim(),
      text: rawText,
    });

    if (!note) return false;
    saveNotes(addPlainNote(current.notes, note));
    return true;
  };

  const readSelection = () => {
    const control = controlRef.current;
    selectionRef.current = {
      from: control?.selectionStart ?? 0,
      to: control?.selectionEnd ?? 0,
    };
  };

  /**
   * Поставить ссылку на слово: текст можно заменить прямо в диалоге,
   * тогда диапазоны примечаний и других ссылок того же поля сдвигаются.
   */
  const applyLink = (payload, editingLink = null) => {
    const current = latest.current;
    const { from, to } = selectionRef.current;

    const result = applyPlainLink({
      value: current.value,
      notes: current.notes,
      links: current.links,
      field: current.field,
      ref: current.refId,
      from,
      to,
      label: payload.text,
      payload,
      editingId: editingLink?.id ?? null,
    });

    if (!result) return false;

    // Текст, ссылки и примечания меняются вместе: иначе второй вызов
    // перезапишет первый устаревшим состоянием формы
    if (result.delta) {
      if (typeof current.onAnnotate !== 'function') return false;
      current.onAnnotate({ value: result.value, links: result.links, notes: result.notes });
      return true;
    }

    current.onLinksChange?.(result.links);
    return true;
  };

  const removeLink = (link) => {
    const current = latest.current;
    current.onLinksChange?.(removePlainLink(current.links, link.id));
    return true;
  };

  /** Ссылка под курсором или выделением — для Ctrl+Shift+K. */
  const linkAtSelection = () => {
    const { from, to } = selectionRef.current;
    return fieldLinks.find((link) => from >= link.from && to <= link.to) ?? null;
  };

  const openCreate = () => {
    readSelection();
    setPopover({ mode: 'create', noteId: null, text: '', anchor: anchorFor(controlRef.current) });
  };

  const openEdit = (note) => {
    readSelection();
    setPopover({ mode: 'edit', noteId: note.id, text: note.text, anchor: anchorFor(controlRef.current) });
  };

  const closePopover = () => setPopover(null);

  const handleSave = (text) => {
    if (popover?.mode !== 'edit') {
      if (createNote(text)) closePopover();
      return;
    }

    saveNotes(setPlainNoteText(latest.current.notes, popover.noteId, text));
    closePopover();
  };

  const handleDelete = () => {
    saveNotes(removePlainNote(latest.current.notes, popover.noteId));
    closePopover();
  };

  /** Новая ссылка на выделенное слово. */
  const openLinkCreate = () => {
    readSelection();
    const { from, to } = selectionRef.current;
    if (to <= from) return;

    openLinkDialog({
      mode: 'create',
      initial: {
        kind: 'external',
        href: '',
        newTab: true,
        text: latest.current.value.slice(from, to),
        hasLink: false,
      },
      apply: (payload) => applyLink(payload),
    });
  };

  /** Редактирование ссылки, уже стоящей в поле. */
  const openLinkEdit = (link) => {
    selectionRef.current = { from: link.from, to: link.to };

    openLinkDialog({
      mode: 'edit',
      initial: {
        kind: link.kind,
        href: link.kind === 'external' ? link.href : '',
        newTab: link.newTab,
        text: link.word,
        hasLink: true,
        target:
          link.kind === 'internal'
            ? {
                targetType: link.targetType,
                targetId: link.targetId,
                targetBlockId: link.targetBlockId,
                targetLabel: link.targetLabel,
                targetBadge: link.targetBadge,
              }
            : null,
      },
      apply: (payload) => applyLink(payload, link),
      remove: () => removeLink(link),
    });
  };

  // Фокус и выделение делают поле целью для кнопок «Примечание» и «Ссылка»
  useEffect(() => {
    const control = controlRef.current;
    if (!control) return undefined;

    const register = () => {
      readSelection();
      const { from, to } = selectionRef.current;

      setNoteTarget({
        token: tokenRef.current,
        field,
        refId,
        anchor: anchorFor(control),
        hasSelection: to > from,
        create: createNote,
      });

      setLinkTarget({
        token: tokenRef.current,
        field,
        refId,
        hasSelection: to > from,
        open: openLinkCreate,
        remove: () => {
          const link = linkAtSelection();
          if (link) removeLink(link);
        },
      });
    };

    // Курсор мог уйти на панель инструментов, в поле примечания или в диалог
    // ссылки — в этом случае цель не сбрасываем, иначе кнопки погаснут.
    const handleBlur = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        const keep =
          active?.closest?.('.toolbar') || active?.closest?.('.note-popover') || active?.closest?.('.modal-overlay');
        if (!keep) {
          clearNoteTarget(tokenRef.current);
          clearLinkTarget(tokenRef.current);
        }
      }, 0);
    };

    control.addEventListener('focus', register);
    control.addEventListener('select', register);
    control.addEventListener('keyup', register);
    control.addEventListener('mouseup', register);
    control.addEventListener('blur', handleBlur);

    return () => {
      control.removeEventListener('focus', register);
      control.removeEventListener('select', register);
      control.removeEventListener('keyup', register);
      control.removeEventListener('mouseup', register);
      control.removeEventListener('blur', handleBlur);
      clearNoteTarget(tokenRef.current);
      clearLinkTarget(tokenRef.current);
    };
    // createNote/openLinkCreate читают latest и selectionRef, поэтому эффект
    // не пересоздаётся на каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, refId, setNoteTarget, clearNoteTarget, setLinkTarget, clearLinkTarget]);

  const handleKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      openCreate();
      return;
    }

    onKeyDown?.(event);
  };

  return (
    <span
      className={[
        'note-field',
        fieldNotes.length > 0 ? 'has-notes' : '',
        fieldLinks.length > 0 ? 'has-links' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Control
        {...controlProps}
        ref={controlRef}
        className={['note-field__control', className].filter(Boolean).join(' ')}
        value={value}
        onKeyDown={handleKeyDown}
      />

      <span className="note-field__actions">
        {fieldLinks.map((link) => (
          <button
            key={link.id}
            type="button"
            className="note-field__link"
            title={link.kind === 'internal' ? `Ведёт на: ${link.targetLabel}` : link.href}
            aria-label={`Ссылка: ${link.word || link.href}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openLinkEdit(link)}
          >
            <Icon name="link" size={12} />
          </button>
        ))}

        {fieldNotes.map((note) => {
          const number = numberById?.get(note.id);

          return (
            <button
              key={note.id}
              type="button"
              className="note-field__badge"
              title={note.text}
              aria-label={`Примечание${number ? ` ${number}` : ''}: ${note.text}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openEdit(note)}
            >
              {number ?? '•'}
            </button>
          );
        })}

        <button
          type="button"
          className="note-field__add note-field__add--link"
          title="Ссылка на слово — Ctrl+K"
          aria-label="Добавить ссылку"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLinkCreate}
        >
          <Icon name="link" size={12} />
        </button>

        <button
          type="button"
          className="note-field__add"
          title="Примечание к тексту"
          aria-label="Добавить примечание"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openCreate}
        >
          <Icon name="note" size={12} />
        </button>
      </span>

      {popover && (
        <NotePopover
          key={`${popover.mode}-${popover.noteId ?? 'new'}-${popover.anchor?.top ?? 0}`}
          mode={popover.mode}
          initialText={popover.text}
          anchor={popover.anchor}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={closePopover}
        />
      )}
    </span>
  );
}
