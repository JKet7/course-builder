import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NOTE_MARK_TYPE, collectNotes, createNoteId, normalizeNoteText } from '../../../utils/notes.js';

/**
 * Примечания к тексту в редакторе (Правка 5).
 *
 * Метка inlineNote висит на слове или фразе: attrs.noteId — идентификатор,
 * attrs.text — короткий текст примечания. Номер примечания не хранится в документе:
 * плагин InlineNoteNumbering считает его из структуры (utils/notes.js) и вставляет
 * виджет-номер сразу после последнего вхождения метки — в DOM это
 * span.inline-note__mark с data-note-number (тот же класс, что и в режиме чтения).
 *
 * Ctrl+Alt+M не открывает поле напрямую: расширение шлёт событие редактора
 * inline-note:request, а панель инструментов (toolbar/NoteGroup.jsx) показывает popover.
 */

/** Метка примечания на слове. */
export const InlineNote = Mark.create({
  name: NOTE_MARK_TYPE,

  // Продолжение набора после примечания — обычный текст, без метки
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-id'),
        renderHTML: (attributes) => (attributes.noteId ? { 'data-note-id': attributes.noteId } : {}),
      },
      text: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-note-text') ?? '',
        renderHTML: (attributes) => (attributes.text ? { 'data-note-text': attributes.text } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'inline-note' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setInlineNote: (attributes) => ({ commands }) => commands.setMark(this.name, attributes),
      unsetInlineNote: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        // Панель инструментов слушает событие редактора и открывает поле примечания
        this.editor.emit('inline-note:request');
        return true;
      },
    };
  },
});

/** Виджет-номер примечания: не часть документа, поэтому нумерацию можно пересчитывать. */
function createNoteMarker(note) {
  const marker = document.createElement('span');
  marker.className = 'inline-note__mark';
  marker.setAttribute('data-note-id', note.noteId);
  marker.setAttribute('data-note-number', String(note.number));
  marker.setAttribute('data-note-text', note.text);
  marker.setAttribute('contenteditable', 'false');
  marker.title = `Примечание ${note.number}`;
  marker.textContent = String(note.number);
  return marker;
}

/** Декорации примечаний: номер после последнего вхождения каждой метки. */
function buildNoteDecorations(doc, offset = 0) {
  const notes = collectNotes(doc.toJSON());
  if (notes.length === 0) return DecorationSet.empty;

  const ends = new Map();
  doc.descendants((node, position) => {
    if (!node.isText) return;

    for (const mark of node.marks ?? []) {
      if (mark.type.name !== NOTE_MARK_TYPE) continue;

      const noteId = mark.attrs?.noteId;
      if (noteId) ends.set(noteId, position + node.nodeSize);
    }
  });

  const decorations = [];
  for (const note of notes) {
    const position = ends.get(note.noteId);
    if (position === undefined) continue;

    // Номер сквозной по слайду: offset — примечания предыдущих фрагментов
    const numbered = offset > 0 ? { ...note, number: note.number + offset } : note;

    decorations.push(
      Decoration.widget(position, () => createNoteMarker(numbered), {
        side: 1,
        // Номер и текст в ключе: после правки примечания виджет перерисовывается
        key: `inline-note-${note.noteId}-${numbered.number}-${note.text}`,
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Плагин, который держит номера примечаний в актуальном состоянии.
 * offset — сколько примечаний было в предыдущих фрагментах слайда: TiptapEditor
 * обновляет его в storage при изменении слайда и перерисовывает декорации.
 */
export const InlineNoteNumbering = Extension.create({
  name: 'inlineNoteNumbering',

  addOptions() {
    return { offset: 0 };
  },

  addStorage() {
    return { offset: Math.max(0, Number(this.options.offset) || 0) };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('inlineNoteNumbering'),
        props: {
          decorations: (state) =>
            buildNoteDecorations(state.doc, Math.max(0, Number(this.storage?.offset) || 0)),
        },
      }),
    ];
  },
});

/** Диапазоны и текст примечаний документа: Map(noteId → { noteId, text, ranges }). */
export function collectNoteRanges(doc) {
  const notes = new Map();

  doc.descendants((node, position) => {
    if (!node.isText) return;

    for (const mark of node.marks ?? []) {
      if (mark.type.name !== NOTE_MARK_TYPE) continue;

      const noteId = mark.attrs?.noteId;
      if (!noteId) continue;

      const range = { from: position, to: position + node.nodeSize };
      const text = mark.attrs?.text ?? '';
      const note = notes.get(noteId);

      if (note) {
        note.ranges.push(range);
        if (text) note.text = text;
      } else {
        notes.set(noteId, { noteId, text, ranges: [range] });
      }
    }
  });

  return notes;
}

/** Примечание по идентификатору: { noteId, text, from, to } или null. */
export function findInlineNote(editor, noteId) {
  if (!editor || editor.isDestroyed || !noteId) return null;

  const note = collectNoteRanges(editor.state.doc).get(noteId);
  if (!note) return null;

  return {
    noteId,
    text: note.text,
    from: note.ranges[0].from,
    to: note.ranges[note.ranges.length - 1].to,
  };
}

/** Примечание под курсором или выделением: { noteId, text, from, to } или null. */
export function getNoteAtSelection(editor) {
  if (!editor || editor.isDestroyed) return null;

  const { selection } = editor.state;
  const notes = collectNoteRanges(editor.state.doc);

  for (const [noteId, note] of notes) {
    const hit = note.ranges.some((range) => range.from <= selection.to && range.to >= selection.from);
    if (hit) return findInlineNote(editor, noteId);
  }

  return null;
}

/**
 * Создать примечание на выделенном фрагменте.
 * Возвращает false, если выделения нет или текст пустой.
 */
export function insertInlineNote(editor, rawText) {
  if (!editor || editor.isDestroyed) return false;

  const text = normalizeNoteText(rawText);
  const { empty } = editor.state.selection;
  if (empty || !text) return false;

  const noteId = createNoteId();
  return editor.chain().focus().setMark(NOTE_MARK_TYPE, { noteId, text }).run();
}

/** Изменить текст существующего примечания на всех его вхождениях. */
export function updateInlineNote(editor, noteId, rawText) {
  if (!editor || editor.isDestroyed || !noteId) return false;

  const text = normalizeNoteText(rawText);
  const ranges = collectNoteRanges(editor.state.doc).get(noteId)?.ranges ?? [];
  const markType = editor.schema.marks[NOTE_MARK_TYPE];
  if (!text || ranges.length === 0 || !markType) return false;

  const { tr } = editor.state;
  ranges.forEach(({ from, to }) => {
    tr.removeMark(from, to, markType);
    tr.addMark(from, to, markType.create({ noteId, text }));
  });

  editor.view.dispatch(tr);
  return true;
}

/** Удалить примечание: снимаем метку со всех вхождений — нумерация пересчитается сама. */
export function removeInlineNote(editor, noteId) {
  if (!editor || editor.isDestroyed || !noteId) return false;

  const ranges = collectNoteRanges(editor.state.doc).get(noteId)?.ranges ?? [];
  const markType = editor.schema.marks[NOTE_MARK_TYPE];
  if (ranges.length === 0 || !markType) return false;

  const { tr } = editor.state;
  ranges.forEach(({ from, to }) => tr.removeMark(from, to, markType));

  editor.view.dispatch(tr);
  return true;
}
