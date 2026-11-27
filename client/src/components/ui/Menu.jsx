import Icon from './Icon.jsx';

/**
 * Меню действий (нативный <details> — без внешних зависимостей).
 * items: [{ key, label, icon, variant?: 'danger', onClick }]
 * icon — иконка кнопки-триггера, align — к какой стороне прижать список.
 */
export default function Menu({
  label = 'Действия',
  items = [],
  icon = 'chevronDown',
  align = 'right',
  triggerClassName = '',
}) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  /** Пункт меню закрывает <details>, иначе список остаётся открытым. */
  const select = (item) => (event) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    item.onClick?.(event);
  };

  return (
    <details className="menu">
      <summary
        className={['menu__trigger', triggerClassName].filter(Boolean).join(' ')}
        aria-label={label}
        title={label}
      >
        <Icon name={icon} size={16} />
      </summary>

      <div className={['menu__list', align === 'left' ? 'menu__list--left' : ''].filter(Boolean).join(' ')}>
        {visible.map((item) => (
          <button
            key={item.key}
            type="button"
            className={['menu__item', item.variant === 'danger' ? 'menu__item--danger' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={select(item)}
          >
            {item.icon && <Icon name={item.icon} size={16} />}
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
