import { themeVariables } from '../../utils/themes.js';

/** Мини-макет интерфейса в цветах редактируемой темы. */
export default function ThemePreview({ name, colors }) {
  return (
    <aside className="theme-preview" style={themeVariables(colors)} aria-label="Предпросмотр темы">
      <span className="theme-preview__label">Предпросмотр</span>

      <div className="theme-preview__card">
        <h3 className="theme-preview__title">{name || 'Название темы'}</h3>
        <p className="theme-preview__text">Так выглядят заголовки, текст и подписи в выбранной теме.</p>
        <p className="theme-preview__muted">Второстепенный текст и подсказки.</p>

        <div className="theme-preview__actions">
          <span className="theme-preview__button">Кнопка</span>
          <span className="theme-preview__link">Ссылка</span>
        </div>
      </div>

      <div className="theme-preview__field">
        <span className="theme-preview__field-label">Поле ввода</span>
        <span className="theme-preview__input">Текст ответа</span>
      </div>
    </aside>
  );
}
