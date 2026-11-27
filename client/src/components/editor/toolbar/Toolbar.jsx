import { useEffect, useReducer, useRef } from 'react';
import AddContentGroup from './AddContentGroup.jsx';
import FontGroup from './FontGroup.jsx';
import FormatGroup from './FormatGroup.jsx';
import HistoryGroup from './HistoryGroup.jsx';
import LinksGroup from './LinksGroup.jsx';
import ListGroup from './ListGroup.jsx';
import NoteGroup from './NoteGroup.jsx';
import TextStyleGroup from './TextStyleGroup.jsx';

/**
 * Панель инструментов редактора (одна на блок, закреплена сверху).
 * Подписывается на транзакции Tiptap, чтобы кнопки отражали активные метки.
 * onAddContent передаётся только в теории: в остальных блоках группы
 * «Добавить контент» нет, остальные кнопки работают с активным полем.
 */
export default function Toolbar({ editor, onAddContent }) {
  const [, forceUpdate] = useReducer((value) => value + 1, 0);
  const toolbarRef = useRef(null);

  // Тулбар во всю ширину строки, поэтому закреплённые панели содержания
  // (теория, тест, глоссарий) должны отступать ещё и на его высоту — иначе при
  // прокрутке он наезжает на них. Высоту не хардкодим: на узком экране кнопки
  // переносятся на вторую строку, поэтому меряем и обновляем при изменении
  // размера. В режиме чтения тулбара нет — переменную убираем, и панели
  // поднимаются к шапке (фолбэк в CSS — 0).
  useEffect(() => {
    const node = toolbarRef.current;
    if (!node) return undefined;

    const applyHeight = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty('--toolbar-h', `${height}px`);
    };

    applyHeight();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(applyHeight) : null;
    observer?.observe(node);
    window.addEventListener('resize', applyHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', applyHeight);
      document.documentElement.style.removeProperty('--toolbar-h');
    };
  }, []);

  useEffect(() => {
    if (!editor) return undefined;

    const handler = () => forceUpdate();
    editor.on('transaction', handler);
    editor.on('selectionUpdate', handler);

    return () => {
      editor.off('transaction', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Панель инструментов" ref={toolbarRef}>
      <HistoryGroup editor={editor} />
      <span className="toolbar__divider" aria-hidden="true" />

      {onAddContent && (
        <>
          <AddContentGroup onAdd={onAddContent} />
          <span className="toolbar__divider" aria-hidden="true" />
        </>
      )}

      <TextStyleGroup editor={editor} />
      <FontGroup editor={editor} />
      <span className="toolbar__divider" aria-hidden="true" />
      <FormatGroup editor={editor} />
      <span className="toolbar__divider" aria-hidden="true" />
      <ListGroup editor={editor} />
      <span className="toolbar__divider" aria-hidden="true" />
      <LinksGroup editor={editor} />
      <NoteGroup editor={editor} />

      {!editor && <span className="toolbar__hint">Нет активного текстового поля</span>}
    </div>
  );
}
