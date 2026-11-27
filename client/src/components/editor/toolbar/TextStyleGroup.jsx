import ToolbarDropdown from './ToolbarDropdown.jsx';

const STYLES = [
  { key: 'paragraph', label: 'Обычный текст', hint: 'Ctrl+Shift+N' },
  { key: 'h1', label: 'Заголовок 1', hint: 'Ctrl+Alt+1' },
  { key: 'h2', label: 'Заголовок 2', hint: 'Ctrl+Alt+2' },
  { key: 'h3', label: 'Заголовок 3', hint: 'Ctrl+Alt+3' },
];

/** Текущий стиль абзаца: «Обычный текст» или «Заголовок N». */
function currentStyle(editor) {
  if (!editor || editor.isDestroyed) return STYLES[0];

  for (const level of [1, 2, 3]) {
    if (editor.isActive('heading', { level })) return STYLES[level];
  }

  return STYLES[0];
}

/** Выбор стиля текста (обычный/заголовки 1–3). */
export default function TextStyleGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;
  const active = currentStyle(editor);

  const apply = (key) => {
    if (!ready) return;

    if (key === 'paragraph') {
      editor.chain().focus().setParagraph().run();
      return;
    }

    editor
      .chain()
      .focus()
      .toggleHeading({ level: Number(key.slice(1)) })
      .run();
  };

  return (
    <ToolbarDropdown icon="type" label={active.label} title="Стиль текста" disabled={!ready} className="tool-dropdown--wide">
      {({ close }) => (
        <div className="tool-menu">
          {STYLES.map((style) => (
            <button
              key={style.key}
              type="button"
              role="menuitem"
              className={active.key === style.key ? 'tool-menu__item is-active' : 'tool-menu__item'}
              onClick={() => {
                apply(style.key);
                close();
              }}
            >
              <span className="tool-menu__label">{style.label}</span>
              <span className="tool-menu__hint">{style.hint}</span>
            </button>
          ))}
        </div>
      )}
    </ToolbarDropdown>
  );
}
