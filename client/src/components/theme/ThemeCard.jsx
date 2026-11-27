import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { DEFAULT_THEME_COLORS } from '../../utils/themes.js';

/** Карточка темы: превью палитры, статус и действия. */
export default function ThemeCard({ theme, applying = false, onApply, onEdit, onCopy, onDelete }) {
  const colors = theme.colors ?? DEFAULT_THEME_COLORS;
  const palette = Array.isArray(colors.themeColors) && colors.themeColors.length > 0
    ? colors.themeColors
    : DEFAULT_THEME_COLORS.themeColors;

  return (
    <article className={['theme-card', theme.isActive ? 'is-active' : ''].filter(Boolean).join(' ')}>
      <header className="theme-card__head">
        <h2 className="theme-card__title">{theme.name}</h2>
        <div className="theme-card__badges">
          <span className={`badge ${theme.isGlobal ? 'badge--blue' : 'badge--gray'}`}>
            {theme.isGlobal ? 'Глобальная' : 'Личная'}
          </span>
          {theme.isActive && <span className="badge badge--green">Активна</span>}
        </div>
      </header>

      <div className="theme-card__preview" aria-hidden="true">
        <div className="theme-card__strip" style={{ background: colors.background }}>
          <span className="theme-card__surface" style={{ background: colors.surface, borderColor: colors.border }} />
          <span className="theme-card__accent" style={{ background: colors.accent }} />
        </div>

        <div className="theme-card__palette">
          {palette.map((hex, index) => (
            <span key={`${hex}-${index}`} className="theme-card__dot" style={{ background: hex }} />
          ))}
        </div>
      </div>

      <div className="theme-card__actions">
        <Button
          size="sm"
          variant={theme.isActive ? 'secondary' : 'primary'}
          disabled={theme.isActive || applying}
          onClick={() => onApply(theme)}
        >
          {applying && <Icon name="loader" size={14} className="icon--spin" />}
          {theme.isActive ? 'Активна' : 'Применить'}
        </Button>

        {theme.canEdit && (
          <Button size="sm" variant="ghost" onClick={() => onEdit(theme)}>
            <Icon name="pencil" size={14} />
            Изменить
          </Button>
        )}

        {onCopy && (
          <Button size="sm" variant="ghost" onClick={() => onCopy(theme)}>
            <Icon name="copy" size={14} />
            Копия
          </Button>
        )}

        {theme.canDelete && (
          <Button size="sm" variant="ghost" className="theme-card__delete" onClick={() => onDelete(theme)}>
            <Icon name="trash" size={14} />
            Удалить
          </Button>
        )}
      </div>
    </article>
  );
}
