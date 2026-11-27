import { useId } from 'react';

/** Текстовое поле с подписью и текстом ошибки. */
export function Input({ label, error, hint, className = '', ...props }) {
  const id = useId();
  const inputId = props.id ?? id;

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={error ? 'input input--invalid' : 'input'}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

/** Многострочное поле. */
export function Textarea({ label, error, hint, rows = 3, className = '', ...props }) {
  const id = useId();
  const textareaId = props.id ?? id;

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="field__label" htmlFor={textareaId}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={error ? 'input input--invalid' : 'input'}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export default Input;
