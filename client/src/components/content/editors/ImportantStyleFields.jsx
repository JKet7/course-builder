import EditorField from './EditorField.jsx';
import {
  IMPORTANT_LIMITS,
  IMPORTANT_PALETTE,
  IMPORTANT_THEME_COLORS,
  importantBorderColor,
  normalizeImportantStyle,
} from '../../../utils/important.js';

/** Все значения диапазона: [8, 12] → [8, 9, 10, 11, 12]. */
const range = ([min, max]) => Array.from({ length: max - min + 1 }, (_, index) => min + index);

/**
 * Оформление блока «Важное»: цвет фона, рамка, толщина и скругление.
 *
 * Значение — только `data.important` (см. utils/important.js), поэтому
 * компонент не знает про Tiptap: он отдаёт новое оформление наверх, а
 * ContentEditor сохраняет его вместе с документом.
 */
export default function ImportantStyleFields({ value, onChange }) {
  const style = normalizeImportantStyle(value);
  // Нативный color-picker требует конкретный цвет: пока свой не выбран,
  // показываем цвет темы (как в DialogEditor).
  const background = style.background || IMPORTANT_THEME_COLORS.background;

  return (
    <div className="important-style">
      <EditorField label="Цвет блока" className="content-field--grow">
        <div className="important-palette" role="group" aria-label="Цвет блока">
          {IMPORTANT_PALETTE.map((item) => {
            const active = style.background === item.value;

            return (
              <button
                key={item.value || 'theme'}
                type="button"
                className={[
                  'important-palette__swatch',
                  item.value ? '' : 'important-palette__swatch--theme',
                  active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={item.value ? { backgroundColor: item.value } : undefined}
                title={item.label}
                aria-label={`Цвет блока: ${item.label}`}
                aria-pressed={active}
                onClick={() => onChange({ ...style, background: item.value })}
              />
            );
          })}
        </div>
      </EditorField>

      <EditorField label="Свой цвет" className="content-field--grow">
        <div className="important-color">
          <input
            type="color"
            className="important-color__input"
            value={background}
            aria-label="Свой цвет блока"
            onChange={(event) => onChange({ ...style, background: event.target.value.toUpperCase() })}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!style.background}
            onClick={() => onChange({ ...style, background: '' })}
          >
            Как в теме
          </button>
        </div>
      </EditorField>

      <EditorField label="Рамка" className="content-field--grow">
        <div className="important-color">
          <input
            type="color"
            className="important-color__input"
            value={importantBorderColor(style)}
            aria-label="Цвет рамки блока"
            onChange={(event) => onChange({ ...style, borderColor: event.target.value.toUpperCase() })}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!style.borderColor}
            onClick={() => onChange({ ...style, borderColor: '' })}
          >
            Авто
          </button>
        </div>
      </EditorField>

      <EditorField label="Толщина">
        <select
          className="tool-select tool-select--sm"
          value={style.borderWidth}
          aria-label="Толщина рамки блока"
          onChange={(event) => onChange({ ...style, borderWidth: Number(event.target.value) })}
        >
          {range(IMPORTANT_LIMITS.borderWidth).map((width) => (
            <option key={width} value={width}>
              {width} px
            </option>
          ))}
        </select>
      </EditorField>

      <EditorField label="Скругление">
        <select
          className="tool-select tool-select--sm"
          value={style.radius}
          aria-label="Скругление углов блока"
          onChange={(event) => onChange({ ...style, radius: Number(event.target.value) })}
        >
          {range(IMPORTANT_LIMITS.radius).map((radius) => (
            <option key={radius} value={radius}>
              {radius} px
            </option>
          ))}
        </select>
      </EditorField>
    </div>
  );
}
