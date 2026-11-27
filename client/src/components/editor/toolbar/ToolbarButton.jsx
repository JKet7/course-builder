import Icon from '../../ui/Icon.jsx';

/**
 * Кнопка панели инструментов.
 * onMouseDown preventDefault — чтобы клик не убирал фокус и выделение из редактора.
 */
export default function ToolbarButton({
  icon,
  label,
  hint,
  active = false,
  disabled = false,
  className = '',
  onClick,
  children,
}) {
  const title = hint ? `${label} — ${hint}` : label;

  return (
    <button
      type="button"
      className={['tool-btn', active ? 'is-active' : '', className].filter(Boolean).join(' ')}
      title={title}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}
