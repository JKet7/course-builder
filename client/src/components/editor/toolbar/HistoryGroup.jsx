import ToolbarButton from './ToolbarButton.jsx';

/** Отмена/повтор действий (история Tiptap, Ctrl+Z / Ctrl+Y). */
export default function HistoryGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;

  return (
    <>
      <ToolbarButton
        icon="undo"
        label="Отменить"
        hint="Ctrl+Z"
        disabled={!ready || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarButton
        icon="redo"
        label="Повторить"
        hint="Ctrl+Y"
        disabled={!ready || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
    </>
  );
}
