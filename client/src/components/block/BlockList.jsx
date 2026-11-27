import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import BlockCard from './BlockCard.jsx';

/**
 * Левая панель страницы курса: поиск по названию и список блоков.
 * onAdd — карточка «Добавить блок» в конце списка (только редактору);
 * остальные действия прокидываются в карточку и рисуют меню ⋮.
 */
export default function BlockList({
  blocks,
  activeId,
  onSelect,
  onAdd,
  onEdit,
  onDownload,
  onDuplicate,
  onDelete,
  onResetChecklist,
}) {
  const [query, setQuery] = useState('');

  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? blocks.filter((block) => String(block.title ?? '').toLowerCase().includes(trimmed))
    : blocks;

  return (
    <div className="course-blocks">
      <div className="course-search">
        <Icon name="search" size={16} className="course-search__icon" />

        <input
          type="search"
          className="course-search__input"
          value={query}
          placeholder="Поиск блока..."
          aria-label="Поиск блока"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="course-blocks__empty">
          {blocks.length === 0 ? 'В курсе пока нет блоков' : 'Блоки не найдены'}
        </p>
      ) : (
        <ul className="course-blocks__list">
          {filtered.map((block) => (
            <li key={block.id}>
              <BlockCard
                block={block}
                active={block.id === activeId}
                onSelect={onSelect}
                onEdit={onEdit ? () => onEdit(block) : undefined}
                onDownload={onDownload ? () => onDownload(block) : undefined}
                onDuplicate={onDuplicate ? () => onDuplicate(block) : undefined}
                onDelete={onDelete ? () => onDelete(block) : undefined}
                onResetChecklist={onResetChecklist ? () => onResetChecklist(block) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {onAdd && (
        <button type="button" className="course-blocks__add" onClick={onAdd}>
          <Icon name="plus" size={18} />
          Добавить блок
        </button>
      )}
    </div>
  );
}

