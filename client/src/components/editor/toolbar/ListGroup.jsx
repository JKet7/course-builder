import { useState } from 'react';
import { ensureRootListId } from '../extensions/multiLevelList.js';
import MultiLevelListDialog from './MultiLevelListDialog.jsx';
import ToolbarButton from './ToolbarButton.jsx';

/**
 * Группа «Списки» (Правка 4).
 * Маркированный/нумерованный список, понижение и повышение уровня (Tab / Shift+Tab)
 * и настройка многоуровневого списка — до 9 уровней, как в Word.
 */
export default function ListGroup({ editor }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const ready = Boolean(editor) && !editor.isDestroyed;

  const isBullet = ready && editor.isActive('bulletList');
  const isOrdered = ready && editor.isActive('orderedList');
  const canIndent = ready && editor.can().sinkListItem('listItem');
  const canOutdent = ready && editor.can().liftListItem('listItem');

  // После создания списка сразу выдаём listId: так нумерация списков независима
  const toggleList = (command) => {
    command();
    ensureRootListId(editor);
  };

  return (
    <>
      <ToolbarButton
        icon="list"
        label="Маркированный список"
        hint="Ctrl+Shift+8"
        active={isBullet}
        disabled={!ready}
        onClick={() => toggleList(() => editor.chain().focus().toggleBulletList().run())}
      />
      <ToolbarButton
        icon="listOrdered"
        label="Нумерованный список"
        hint="Ctrl+Shift+7"
        active={isOrdered}
        disabled={!ready}
        onClick={() => toggleList(() => editor.chain().focus().toggleOrderedList().run())}
      />
      <ToolbarButton
        icon="indentDecrease"
        label="Повысить уровень"
        hint="Shift+Tab"
        disabled={!canOutdent}
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}
      />
      <ToolbarButton
        icon="indentIncrease"
        label="Понизить уровень"
        hint="Tab"
        disabled={!canIndent}
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
      />
      <ToolbarButton
        icon="listTree"
        label="Многоуровневый список"
        hint="Настройка уровней"
        disabled={!ready}
        onClick={() => setDialogOpen(true)}
      />

      {dialogOpen && <MultiLevelListDialog editor={editor} onClose={() => setDialogOpen(false)} />}
    </>
  );
}
