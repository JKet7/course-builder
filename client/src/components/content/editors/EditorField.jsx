/** Поле редактора контента: подпись, контрол, подсказка или ошибка. */
export default function EditorField({ label, hint, error, className = '', children }) {
  return (
    <div className={['content-field', className].filter(Boolean).join(' ')}>
      {label && <span className="content-field__label">{label}</span>}
      {children}
      {error && <span className="content-field__error">{error}</span>}
      {hint && !error && <span className="content-field__hint">{hint}</span>}
    </div>
  );
}

/** Ряд кнопок под полями редактора. */
export function EditorActions({ children }) {
  return <div className="content-actions">{children}</div>;
}
