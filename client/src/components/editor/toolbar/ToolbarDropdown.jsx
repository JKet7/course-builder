import { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';

/**
 * Кнопка панели инструментов с выпадающей панелью.
 * Дети — функция ({ close }) => JSX либо готовые элементы.
 * Панель закрывается по клику вне неё и по Escape.
 */
export default function ToolbarDropdown({
  icon,
  label,
  title,
  active = false,
  disabled = false,
  align = 'left',
  className = '',
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={['tool-dropdown', `tool-dropdown--${align}`, className].filter(Boolean).join(' ')} ref={rootRef}>
      <button
        type="button"
        className={['tool-btn', 'tool-btn--dropdown', active || open ? 'is-active' : ''].filter(Boolean).join(' ')}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <Icon name={icon} size={16} />}
        {label && <span className="tool-btn__label">{label}</span>}
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div className="tool-dropdown__panel" role="menu">
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}
