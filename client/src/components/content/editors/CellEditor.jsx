import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions, EMPTY_DOC } from '../../editor/TiptapEditor.jsx';
import { useEditorStore } from '../../../store/editorStore.js';

/**
 * Редактор одной ячейки таблицы (Tiptap).
 *
 * Ячейка — такой же документ, как фрагмент «Текст», поэтому в ней работают
 * жирный, курсив, цвет, размер, списки, ссылки и примечания. Редактор
 * смонтирован только у той ячейки, которую сейчас правят: 30×6 настоящих
 * ProseMirror-редакторов на таблицу — это лишние тормоза, а статичную ячейку
 * рисует ContentRenderer.
 *
 * Панель инструментов одна на блок и работает с активным редактором, поэтому
 * при фокусе ячейка сообщает о себе и в store, и родителю (onActivate) — так же
 * делает TiptapEditor.
 */
export default function CellEditor({
  value,
  noteOffset = 0,
  label = 'Текст ячейки',
  onChange,
  onActivate,
  onKeyDown,
}) {
  // Колбэки держим в ref: useEditor запоминает обработчики при создании,
  // иначе каждый ввод уходил бы в устаревшую копию data родителя.
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const editor = useEditor({
    extensions: buildExtensions('Текст ячейки…', noteOffset),
    content: value ?? EMPTY_DOC,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'tiptap tiptap--cell',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
    },
    onUpdate: ({ editor: instance }) => changeRef.current?.(instance.getJSON()),
  });

  const setActiveEditor = useEditorStore((state) => state.setActiveEditor);
  const releaseEditor = useEditorStore((state) => state.releaseEditor);

  // Колбэк держим в ref: иначе эффект пересоздаётся на каждый рендер родителя
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;

  useEffect(() => {
    if (!editor) return undefined;

    const handleFocus = () => {
      setActiveEditor(editor);
      activateRef.current?.(editor);
    };

    editor.on('focus', handleFocus);

    return () => {
      editor.off('focus', handleFocus);
      releaseEditor(editor);
    };
  }, [editor, setActiveEditor, releaseEditor]);

  // Клик по ячейке сразу ставит курсор: ввод начинается без второго клика
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.focus('end');
  }, [editor]);

  // Номера примечаний сквозные по слайду: offset уточняется, когда в соседних
  // ячейках появились примечания. Пустая транзакция перерисовывает декорации.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const storage = editor.storage.inlineNoteNumbering;
    const offset = Math.max(0, Number(noteOffset) || 0);
    if (!storage || storage.offset === offset) return;

    storage.offset = offset;
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, noteOffset]);

  const handleKeyDown = (event) => {
    // Tab внутри списка — вложенность пункта (как в «Тексте»), иначе — переход
    if (event.key === 'Tab' && editor?.isActive('listItem')) return;
    onKeyDown?.(event);
  };

  return (
    <div className="table-editor__editor" onKeyDown={handleKeyDown}>
      <EditorContent editor={editor} />
    </div>
  );
}
