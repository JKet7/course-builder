import { useCallback, useEffect, useState } from 'react';
import { getMarkRange } from '@tiptap/core';
import ToolbarButton from './ToolbarButton.jsx';
import { useLinkStore } from '../../../store/linkStore.js';
import { linkToMarkAttrs } from '../../../utils/links.js';

/** Выделенный текст Tiptap (без лишних пробелов). */
function selectedText(editor) {
  if (!editor || editor.isDestroyed) return '';
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

/** Границы ссылки, в которой стоит курсор (или выделение части ссылки). */
function linkRange(editor) {
  if (!editor || editor.isDestroyed) return null;

  const type = editor.schema.marks.link;
  if (!type) return null;

  try {
    return getMarkRange(editor.state.doc.resolve(editor.state.selection.from), type);
  } catch {
    return null;
  }
}

/** Текст ссылки — для предзаполнения поля «Текст ссылки» при редактировании. */
function linkText(editor) {
  const range = linkRange(editor);
  if (!range) return '';
  return editor.state.doc.textBetween(range.from, range.to, ' ');
}

/** Атрибуты текущей ссылки в виде initial для диалога. */
function initialFromEditor(editor) {
  const attrs = editor.getAttributes('link') ?? {};
  const internal = attrs.linkKind === 'internal';

  return {
    kind: internal ? 'internal' : 'external',
    href: attrs.href ?? '',
    newTab: attrs.newTab ?? attrs.target === '_blank',
    text: selectedText(editor) || linkText(editor),
    hasLink: Boolean(attrs.href),
    target: internal
      ? {
          targetType: attrs.targetType ?? '',
          targetId: attrs.targetId ?? '',
          targetBlockId: attrs.targetBlockId ?? '',
          targetLabel: attrs.targetLabel ?? '',
          targetBadge: attrs.targetBadge ?? '',
        }
      : null,
  };
}

/**
 * Ссылка в Tiptap (Правка 6).
 *
 * Кнопка панели, Ctrl+K и контекстное меню открывают диалог: внешняя ссылка
 * или переход к элементу курса. Клик по ссылке в тексте открывает её для
 * редактирования, Ctrl+Shift+K удаляет. Если выделение — в обычном поле
 * (ячейка таблицы, подпись, реплика), кнопка работает с ним через linkStore.
 */
export default function LinksGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;
  const activeLink = ready && editor.isFocused && editor.isActive('link');

  const openDialog = useLinkStore((state) => state.openDialog);
  const plainTarget = useLinkStore((state) => state.target);

  // Контекстное меню по правому клику: { top, left, onLink }
  const [menu, setMenu] = useState(null);

  /** Поставить ссылку в Tiptap: текст ссылки заменяется, если автор его изменил. */
  const applyToEditor = useCallback(
    (link) => {
      if (!ready || !editor) return false;

      const attrs = linkToMarkAttrs(link);
      const editing = editor.isActive('link');
      const range = editing ? linkRange(editor) : null;
      const from = range?.from ?? editor.state.selection.from;
      const to = range?.to ?? editor.state.selection.to;
      const selected = from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
      const label = String(link.text ?? '').trim();

      if (!editing && !selected) return false;

      if (label && label !== selected) {
        const marks = editor.state.doc
          .resolve(from)
          .marks()
          .filter((mark) => mark.type.name !== 'link')
          .map((mark) => mark.toJSON());

        editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, { type: 'text', text: label, marks: [...marks, { type: 'link', attrs }] })
          .run();

        return true;
      }

      editor.chain().focus().setTextSelection({ from, to }).setLink(attrs).run();
      return true;
    },
    [editor, ready],
  );

  const removeFromEditor = useCallback(() => {
    if (!ready || !editor || !editor.isActive('link')) return false;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return true;
  }, [editor, ready]);

  const openForEditor = useCallback(
    (mode) => {
      if (!ready || !editor) return;

      if (mode === 'edit' || editor.isActive('link')) {
        openDialog({ mode: 'edit', initial: initialFromEditor(editor), apply: applyToEditor, remove: removeFromEditor });
        return;
      }

      if (!selectedText(editor)) return;

      openDialog({
        mode: 'create',
        initial: { kind: 'external', href: '', newTab: true, text: selectedText(editor), hasLink: false },
        apply: applyToEditor,
        remove: removeFromEditor,
      });
    },
    [applyToEditor, editor, openDialog, ready, removeFromEditor],
  );

  const canUse =
    Boolean(activeLink) ||
    Boolean(ready && editor.isFocused && selectedText(editor)) ||
    Boolean(plainTarget?.hasSelection);

  const openCurrent = () => {
    if (ready && editor.isFocused) openForEditor(activeLink ? 'edit' : 'create');
    else if (plainTarget?.hasSelection) plainTarget.open?.();
  };

  // Ctrl+K — диалог, Ctrl+Shift+K — удалить ссылку (как в Word)
  useEffect(() => {
    const handler = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== 'k') return;

      const inEditor = ready && editor.isFocused;
      const inPlain = !inEditor && Boolean(plainTarget?.hasSelection);
      if (!inEditor && !inPlain) return;

      event.preventDefault();

      if (event.shiftKey) {
        if (inEditor) removeFromEditor();
        else plainTarget?.remove?.();
        return;
      }

      if (inEditor) openForEditor(editor.isActive('link') ? 'edit' : 'create');
      else plainTarget?.open?.();
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editor, openForEditor, plainTarget, ready, removeFromEditor]);

  // Клик по ссылке в тексте открывает её для редактирования
  useEffect(() => {
    if (!ready || !editor) return undefined;

    const dom = editor.view?.dom;
    if (!dom) return undefined;

    const handleClick = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      if (!target.closest('a[data-link-kind]')) return;

      event.preventDefault();
      openForEditor('edit');
    };

    dom.addEventListener('click', handleClick);
    return () => dom.removeEventListener('click', handleClick);
  }, [editor, openForEditor, ready]);

  // Контекстное меню: «Добавить ссылку» для выделенного текста
  useEffect(() => {
    if (!ready || !editor) return undefined;

    const dom = editor.view?.dom;
    if (!dom) return undefined;

    const handleContextMenu = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      if (!target.closest('.tiptap')) return;

      const hasSelection = !editor.state.selection.empty;
      const onLink = Boolean(target.closest('a[data-link-kind]'));
      if (!hasSelection && !onLink) return;

      event.preventDefault();
      setMenu({ top: Math.min(event.clientY, (window.innerHeight || 600) - 90), left: event.clientX, onLink });
    };

    dom.addEventListener('contextmenu', handleContextMenu);
    return () => dom.removeEventListener('contextmenu', handleContextMenu);
  }, [editor, ready]);

  useEffect(() => {
    if (!menu) return undefined;

    const close = (event) => {
      if (event?.target?.closest?.('.tool-context-menu')) return;
      setMenu(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <>
      <ToolbarButton
        icon="link"
        label="Ссылка"
        hint="Ctrl+K"
        title="Ссылка — Ctrl+K"
        active={Boolean(activeLink)}
        disabled={!canUse}
        onClick={openCurrent}
      />

      {menu && (
        <div className="tool-context-menu" style={{ top: menu.top, left: menu.left }} role="menu">
          <button
            type="button"
            className="tool-context-menu__item"
            onClick={() => {
              setMenu(null);
              openForEditor(menu.onLink ? 'edit' : 'create');
            }}
          >
            {menu.onLink ? 'Изменить ссылку' : 'Добавить ссылку'}
          </button>

          {menu.onLink && (
            <button
              type="button"
              className="tool-context-menu__item tool-context-menu__item--danger"
              onClick={() => {
                setMenu(null);
                removeFromEditor();
              }}
            >
              Удалить ссылку
            </button>
          )}
        </div>
      )}
    </>
  );
}
