import { useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { Input } from '../ui/Input.jsx';
import ColorField from './ColorField.jsx';
import ThemePreview from './ThemePreview.jsx';
import {
  PALETTE_SIZE,
  THEME_FIELDS,
  THEME_LIMITS,
  validateThemeDraft,
} from '../../utils/themes.js';

/**
 * Форма темы: название, 6 ролей цвета, палитра «Цвета темы» и живой предпросмотр.
 * Клиентская проверка повторяет правила сервера (utils/theme.js).
 */
export default function ThemeEditor({
  mode = 'create',
  initial,
  canToggleGlobal = false,
  saving = false,
  serverErrors = null,
  onSubmit,
  onCancel,
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [colors, setColors] = useState(initial?.colors ?? {});
  const [isGlobal, setIsGlobal] = useState(Boolean(initial?.isGlobal) && canToggleGlobal);
  const [errors, setErrors] = useState({});

  const fieldErrors = { ...(serverErrors ?? {}), ...errors };
  const palette = Array.isArray(colors.themeColors) ? colors.themeColors : [];

  // Ошибки сервера, не привязанные к полю (например, лимит личных тем)
  const extraErrors = Object.entries(serverErrors ?? {})
    .filter(([key]) => key !== 'name' && !key.startsWith('colors'))
    .map(([, message]) => message);

  const setColor = (key, value) => setColors((prev) => ({ ...prev, [key]: value }));

  const setPaletteColor = (index, value) =>
    setColors((prev) => ({
      ...prev,
      themeColors: (prev.themeColors ?? []).map((hex, itemIndex) => (itemIndex === index ? value : hex)),
    }));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (saving) return;

    const result = validateThemeDraft({ name, colors });
    setErrors(result.errors);
    if (!result.ok) return;

    onSubmit({
      name: result.name,
      colors: result.colors,
      isGlobal: canToggleGlobal ? isGlobal : false,
    });
  };

  return (
    <form className="theme-editor" onSubmit={handleSubmit} noValidate>
      <div className="theme-editor__head">
        <h2 className="theme-editor__title">
          {mode === 'create' ? 'Новая тема' : `Тема «${initial?.name ?? ''}»`}
        </h2>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={saving}>
          <Icon name="x" size={16} />
          Закрыть
        </Button>
      </div>

      <div className="theme-editor__body">
        <div className="theme-editor__fields">
          <Input
            label="Название темы"
            name="theme-name"
            value={name}
            maxLength={THEME_LIMITS.name}
            error={fieldErrors.name}
            hint={`До ${THEME_LIMITS.name} символов`}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />

          <div className="theme-editor__colors">
            {THEME_FIELDS.map((field) => (
              <ColorField
                key={field.key}
                name={field.key}
                label={field.label}
                hint={field.hint}
                value={colors[field.key] ?? ''}
                error={fieldErrors[`colors.${field.key}`]}
                onChange={(value) => setColor(field.key, value)}
              />
            ))}
          </div>

          {fieldErrors.colors && (
            <p className="form-error" role="alert">{fieldErrors.colors}</p>
          )}

          {extraErrors.length > 0 && (
            <p className="form-error" role="alert">{extraErrors.join(' ')}</p>
          )}

          <fieldset className="theme-editor__palette">
            <legend className="theme-editor__legend">Палитра «Цвета темы»</legend>
            <p className="theme-editor__hint">
              Эти цвета предлагает тулбар редактора: выделение и цвет текста. Нужно {PALETTE_SIZE} цветов.
            </p>

            <div className="theme-editor__swatches">
              {Array.from({ length: PALETTE_SIZE }, (_, index) => (
                <ColorField
                  key={index}
                  compact
                  name={`palette-${index + 1}`}
                  label={`Цвет ${index + 1}`}
                  value={palette[index] ?? ''}
                  error={fieldErrors[`colors.themeColors.${index}`]}
                  onChange={(value) => setPaletteColor(index, value)}
                />
              ))}
            </div>

            {fieldErrors['colors.themeColors'] && (
              <span className="field__error">{fieldErrors['colors.themeColors']}</span>
            )}
          </fieldset>

          {canToggleGlobal && mode === 'create' && (
            <label className="checkbox theme-editor__global">
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(event) => setIsGlobal(event.target.checked)}
              />
              <span>Глобальная тема — видна всем пользователям</span>
            </label>
          )}
        </div>

        <ThemePreview name={name} colors={colors} />
      </div>

      <div className="theme-editor__actions">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Icon name="loader" size={16} className="icon--spin" /> : <Icon name="save" size={16} />}
          {mode === 'create' ? 'Создать тему' : 'Сохранить'}
        </Button>
      </div>
    </form>
  );
}
