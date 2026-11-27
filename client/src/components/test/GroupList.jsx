import { useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';

/**
 * Список групп теста с фильтрами «Все вопросы» и «Без группы».
 * groups: [{ id, name }], counts: { [groupId]: number }.
 */
export default function GroupList({
  groups,
  counts,
  totalCount,
  unassignedCount,
  activeId,
  canEdit = false,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onMove,
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');

  const startEdit = (group) => {
    setEditingId(group.id);
    setDraftName(group.name);
  };

  const commitEdit = () => {
    const name = draftName.trim();
    if (editingId && name) onRename?.(editingId, name);
    setEditingId(null);
  };

  const handleAdd = (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    onAdd?.(name);
    setNewName('');
  };

  return (
    <div className="group-list">
      <ul className="group-list__items">
        <li className={activeId === 'all' ? 'group-item is-active' : 'group-item'}>
          <button type="button" className="group-item__btn" onClick={() => onSelect('all')}>
            <Icon name="clipboard" size={14} />
            <span className="group-item__name">Все вопросы</span>
            <span className="group-item__count">{totalCount}</span>
          </button>
        </li>

        {groups.map((group, index) => (
          <li key={group.id} className={activeId === group.id ? 'group-item is-active' : 'group-item'}>
            {editingId === group.id ? (
              <input
                className="input input--sm group-item__edit"
                value={draftName}
                autoFocus
                aria-label="Название группы"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitEdit();
                  }
                  if (event.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <button type="button" className="group-item__btn" onClick={() => onSelect(group.id)}>
                <Icon name="layers" size={14} />
                <span className="group-item__name">{group.name}</span>
                <span className="group-item__count">{counts[group.id] ?? 0}</span>
              </button>
            )}

            {canEdit && editingId !== group.id && (
              <span className="group-item__actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Переместить группу «${group.name}» выше`}
                  disabled={index === 0}
                  onClick={() => onMove?.(group.id, -1)}
                >
                  <Icon name="chevronUp" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Переместить группу «${group.name}» ниже`}
                  disabled={index === groups.length - 1}
                  onClick={() => onMove?.(group.id, 1)}
                >
                  <Icon name="chevronDown" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Переименовать группу «${group.name}»`}
                  onClick={() => startEdit(group)}
                >
                  <Icon name="pencil" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  aria-label={`Удалить группу «${group.name}»`}
                  onClick={() => onDelete?.(group)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            )}
          </li>
        ))}

        <li className={activeId === 'none' ? 'group-item is-active' : 'group-item'}>
          <button type="button" className="group-item__btn" onClick={() => onSelect('none')}>
            <Icon name="minus" size={14} />
            <span className="group-item__name">Без группы</span>
            <span className="group-item__count">{unassignedCount}</span>
          </button>
        </li>
      </ul>

      {canEdit && (
        <form className="group-list__add" onSubmit={handleAdd}>
          <input
            className="input input--sm"
            value={newName}
            placeholder="Новая группа"
            aria-label="Название новой группы"
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button type="submit" variant="ghost" size="sm" aria-label="Добавить группу">
            <Icon name="plus" size={16} />
          </Button>
        </form>
      )}
    </div>
  );
}
