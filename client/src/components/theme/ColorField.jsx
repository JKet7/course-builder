import { normalizeHex } from '../../utils/themes.js';

/**
 * Поле цвета темы: нативный color-picker + HEX-поле.
 * Значение хранится строкой как есть, формат проверяется при сохранении формы.
 */
export default function ColorField({ name, label, hint, value, error, compact = false, onChange }) {
  const pickerValue = normalizeHex(value) ?? '#FFFFFF';

  if (compact) {
    return (
      <span
        className={['color-field__swatch', error ? 'color-field__swatch--invalid' : ''].filter(Boolean).join(' ')}
        style={{ background: pickerValue }}
        title={`${label}: ${value}`}
      >
        <input
          type="color"
          className="color-field__input"
          value={pickerValue}
          aria-label={`${label}: выбрать цвет`}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </span>
    );
  }

  return (
    <div className={['color-field', error ? 'color-field--invalid' : ''].filter(Boolean).join(' ')}>
      <span className="color-field__picker" style={{ background: pickerValue }}>
        <input
          type="color"
          className="color-field__input"
          value={pickerValue}
          aria-label={`${label}: выбрать цвет`}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </span>

      <div className="color-field__body">
        <label className="color-field__label" htmlFor={`theme-color-${name}`}>
          {label}
        </label>
        <input
          id={`theme-color-${name}`}
          name={`theme-${name}`}
          className={error ? 'input input--sm input--invalid' : 'input input--sm'}
          value={value}
          spellCheck={false}
          maxLength={7}
          placeholder="#AABBCC"
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {hint && !error && <span className="field__hint">{hint}</span>}
        {error && <span className="field__error">{error}</span>}
      </div>
    </div>
  );
}
