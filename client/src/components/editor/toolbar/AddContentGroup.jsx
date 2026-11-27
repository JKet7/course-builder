import Icon from '../../ui/Icon.jsx';
import { CONTENT_TYPES } from '../../../utils/helpers.js';
import ToolbarDropdown from './ToolbarDropdown.jsx';

/** Список типов контента — общий для тулбара и «плюсиков» на слайде. */
export function ContentTypeMenu({ onSelect, close }) {
  return (
    <div className="tool-menu">
      {CONTENT_TYPES.map((item) => (
        <button
          key={item.type}
          type="button"
          role="menuitem"
          className="tool-menu__item"
          onClick={() => {
            onSelect?.(item.type);
            close?.();
          }}
        >
          <Icon name={item.icon} size={16} />
          <span className="tool-menu__label">{item.label}</span>
          <span className="tool-menu__hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** «Добавить контент» — вставляет фрагмент в конец активного слайда. */
export default function AddContentGroup({ onAdd }) {
  return (
    <ToolbarDropdown
      icon="plus"
      label="Добавить контент"
      title="Добавить фрагмент на слайд"
      disabled={!onAdd}
    >
      {({ close }) => <ContentTypeMenu onSelect={onAdd} close={close} />}
    </ToolbarDropdown>
  );
}
