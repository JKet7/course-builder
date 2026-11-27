import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { CourseLink } from './extensions/courseLink.js';
import { InlineNote, InlineNoteNumbering } from './extensions/inlineNote.js';
import {
  ListNumbering,
  MultiLevelBulletList,
  MultiLevelOrderedList,
} from './extensions/multiLevelList.js';
import { useEditorStore } from '../../store/editorStore.js';

/** Пустой Tiptap-документ (совпадает с server/src/utils/content.js). */
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Набор расширений редактора теории.
 * Underline входит в StarterKit (Tiptap 3), поэтому отдельно его не подключаем.
 * Списки заменены на многоуровневые (Правка 4): свои bulletList/orderedList
 * с настройками уровней и плагином нумерации, ListItem и ListKeymap берём из StarterKit.
 * Ссылка — своё расширение CourseLink (Правка 6): внешняя или внутренняя,
 * с подсказкой «Ведёт на: …»; ссылка из StarterKit отключена, чтобы не
 * дублировать метку.
 * Примечания к тексту (Правка 5) — метка InlineNote и плагин InlineNoteNumbering.
 * noteOffset — сколько примечаний уже было на слайде до этого фрагмента (номера сквозные).
 * Экспортируется для scripts/editor-check.mjs.
 */
export function buildExtensions(placeholder = 'Начните печатать текст…', noteOffset = 0) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      orderedList: false,
      bulletList: false,
    }),
    CourseLink,
    MultiLevelOrderedList,
    MultiLevelBulletList,
    ListNumbering,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    InlineNote,
    InlineNoteNumbering.configure({ offset: Math.max(0, Number(noteOffset) || 0) }),
    Placeholder.configure({ placeholder }),
  ];
}

/**
 * Текстовый редактор слайда (Tiptap).
 * value — Tiptap JSON из TheoryContent.data, onChange получает актуальный JSON.
 * noteOffset — примечания предыдущих фрагментов слайда: от него зависят номера.
 * immediatelyRender: false — чтобы редактор не создавался при SSR-проверке.
 */
export default function TiptapEditor({
  value,
  editable = true,
  placeholder = 'Начните печатать текст…',
  className = '',
  noteOffset = 0,
  onChange,
  onFocus,
}) {
  const offset = Math.max(0, Number(noteOffset) || 0);
  const editor = useEditor({
    extensions: buildExtensions(placeholder, offset),
    content: value ?? EMPTY_DOC,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: ['tiptap', className].filter(Boolean).join(' '),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': placeholder,
      },
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON()),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Слайд пересчитали (добавили примечание в другой фрагмент) — обновляем номера
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const storage = editor.storage.inlineNoteNumbering;
    if (!storage || storage.offset === offset) return;

    storage.offset = offset;
    // Пустая транзакция перерисовывает декорации, документ при этом не меняется
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, offset]);

  // Колбэк держим в ref: иначе эффект пересоздаётся на каждый рендер родителя
  const focusRef = useRef(onFocus);

  // Общая панель инструментов подключается к тому полю, где стоит курсор
  const setActiveEditor = useEditorStore((state) => state.setActiveEditor);
  const releaseEditor = useEditorStore((state) => state.releaseEditor);

  useEffect(() => {
    focusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    if (!editor) return undefined;

    const handleFocus = () => {
      setActiveEditor(editor);
      focusRef.current?.(editor);
    };

    editor.on('focus', handleFocus);

    // Первый созданный редактор сразу становится активным для тулбара
    if (!useEditorStore.getState().activeEditor) setActiveEditor(editor);
    focusRef.current?.(editor);

    return () => {
      editor.off('focus', handleFocus);
      releaseEditor(editor);
    };
  }, [editor, setActiveEditor, releaseEditor]);

  return <EditorContent editor={editor} />;
}
