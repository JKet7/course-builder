import ToolbarButton from './ToolbarButton.jsx';

const FONT_FAMILIES = ['Montserrat', 'Arial', 'Times New Roman', 'Calibri', 'Courier New'];
const MIN_SIZE = 8;
const MAX_SIZE = 72;

/** Гарнитура и размер шрифта (метка textStyle). */
export default function FontGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;
  const attrs = ready ? editor.getAttributes('textStyle') : {};
  const family = attrs.fontFamily ?? '';
  const size = Number.parseInt(attrs.fontSize, 10) || 14;

  const applyFamily = (value) => {
    if (!ready) return;
    editor.chain().focus().setMark('textStyle', { fontFamily: value || null }).run();
  };

  const applySize = (value) => {
    if (!ready) return;
    const next = Math.min(Math.max(value, MIN_SIZE), MAX_SIZE);
    editor.chain().focus().setMark('textStyle', { fontSize: `${next}pt` }).run();
  };

  return (
    <div className="tool-group">
      <select
        className="tool-select"
        aria-label="Шрифт"
        title="Шрифт — Ctrl+Shift+F"
        value={family}
        disabled={!ready}
        onChange={(event) => applyFamily(event.target.value)}
      >
        <option value="">Шрифт по умолчанию</option>
        {FONT_FAMILIES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <input
        className="tool-input tool-input--size"
        type="number"
        aria-label="Размер шрифта"
        title="Размер шрифта — Ctrl+Shift+P"
        min={MIN_SIZE}
        max={MAX_SIZE}
        value={size}
        disabled={!ready}
        onChange={(event) => applySize(Number(event.target.value) || 14)}
      />

      <ToolbarButton
        icon="plus"
        label="Увеличить шрифт"
        disabled={!ready || size >= MAX_SIZE}
        onClick={() => applySize(size + 1)}
      />
    </div>
  );
}
