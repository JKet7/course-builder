import { useThemeStore } from '../../../store/themeStore.js';
import { DEFAULT_THEME_COLORS } from '../../../utils/themes.js';
import ToolbarButton from './ToolbarButton.jsx';
import ToolbarDropdown from './ToolbarDropdown.jsx';

/** Начертание, цвет и выравнивание. Списки — в ListGroup.jsx. */
export default function FormatGroup({ editor }) {
  const ready = Boolean(editor) && !editor.isDestroyed;

  // Палитра «Цвета темы» приходит из активной темы (Шаг 12)
  const themeColors = useThemeStore(
    (state) => state.themes.find((theme) => theme.id === state.activeThemeId)?.colors?.themeColors,
  );
  const palette = themeColors?.length ? themeColors : DEFAULT_THEME_COLORS.themeColors;

  const isActive = (name, attrs) => ready && editor.isActive(name, attrs);
  const chain = () => editor.chain().focus();

  // Выравнивание живёт в attrs абзаца или заголовка
  const blockName = ready && editor.isActive('heading') ? 'heading' : 'paragraph';
  const align = (ready && editor.getAttributes(blockName).textAlign) || 'left';

  return (
    <>
      <ToolbarButton
        icon="bold"
        label="Жирный"
        hint="Ctrl+B"
        active={isActive('bold')}
        disabled={!ready}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolbarButton
        icon="italic"
        label="Курсив"
        hint="Ctrl+I"
        active={isActive('italic')}
        disabled={!ready}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolbarButton
        icon="underline"
        label="Подчёркнутый"
        hint="Ctrl+U"
        active={isActive('underline')}
        disabled={!ready}
        onClick={() => chain().toggleUnderline().run()}
      />
      <ToolbarButton
        icon="strike"
        label="Зачёркнутый"
        active={isActive('strike')}
        disabled={!ready}
        onClick={() => chain().toggleStrike().run()}
      />
      <ToolbarButton
        icon="code"
        label="Моноширинный"
        active={isActive('code')}
        disabled={!ready}
        onClick={() => chain().toggleCode().run()}
      />

      <ToolbarDropdown icon="highlight" label="" title="Выделение цветом" disabled={!ready}>
        {({ close }) => (
          <div className="tool-colors">
            <span className="tool-colors__title">Цвета темы</span>
            <div className="tool-colors__grid">
              {palette.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="tool-colors__swatch"
                  style={{ background: color }}
                  aria-label={`Выделить ${color}`}
                  onClick={() => {
                    chain().toggleHighlight({ color }).run();
                    close();
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="tool-menu__item"
              onClick={() => {
                chain().unsetHighlight().run();
                close();
              }}
            >
              Убрать выделение
            </button>
          </div>
        )}
      </ToolbarDropdown>

      <ToolbarDropdown icon="type" label="A" title="Цвет текста" disabled={!ready}>
        {({ close }) => (
          <div className="tool-colors">
            <span className="tool-colors__title">Цвет текста</span>
            <div className="tool-colors__grid">
              {palette.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="tool-colors__swatch"
                  style={{ background: color }}
                  aria-label={`Цвет ${color}`}
                  onClick={() => {
                    chain().setColor(color).run();
                    close();
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="tool-menu__item"
              onClick={() => {
                chain().unsetColor().run();
                close();
              }}
            >
              Цвет по умолчанию
            </button>
          </div>
        )}
      </ToolbarDropdown>

      <ToolbarButton
        icon="eraser"
        label="Очистить формат"
        disabled={!ready}
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      />

      <span className="toolbar__divider" aria-hidden="true" />

      <ToolbarButton
        icon="alignLeft"
        label="По левому краю"
        active={align === 'left'}
        disabled={!ready}
        onClick={() => chain().setTextAlign('left').run()}
      />
      <ToolbarButton
        icon="alignCenter"
        label="По центру"
        active={align === 'center'}
        disabled={!ready}
        onClick={() => chain().setTextAlign('center').run()}
      />
      <ToolbarButton
        icon="alignRight"
        label="По правому краю"
        active={align === 'right'}
        disabled={!ready}
        onClick={() => chain().setTextAlign('right').run()}
      />
    </>
  );
}
