import RichText from './RichText.jsx';
import {
  dialogAvatarStyle,
  getDialogInitial,
  getDialogLineLayout,
  getDialogTail,
  normalizeDialogData,
} from '../../utils/dialog.js';

/**
 * Аватар персонажа: загруженная картинка или первая буква имени.
 * Область картинки и масштаб выбирает автор (avatarFocus / avatarZoom) — кружок
 * показывает именно ту часть, которая попала в кадр.
 */
function DialogAvatar({ line }) {
  return (
    <span className="content-dialog__avatar">
      {line.avatar ? (
        <img
          className="content-dialog__avatar-img"
          src={line.avatar}
          alt={line.character ? `Персонаж: ${line.character}` : 'Персонаж'}
          style={dialogAvatarStyle(line)}
        />
      ) : (
        <span className="content-dialog__avatar-letter" aria-hidden="true">
          {getDialogInitial(line.character)}
        </span>
      )}
    </span>
  );
}

/**
 * Диалог: несколько реплик персонажей в одном фрагменте слайда.
 *
 * Каждая реплика — аватар и облако с текстом; сторона на слайде и место
 * персонажа берутся из данных реплики, оформление (размер аватара, цвета,
 * толщина рамки, радиус, хвостик, выравнивание текста) — из настроек сцены.
 * Разметка общая с редактором: предпросмотр в карточке выглядит как в просмотре.
 */
export default function DialogView({
  data,
  notes = [],
  links = [],
  numberById,
  onLinkClick,
  className = '',
}) {
  const dialog = normalizeDialogData(data);

  return (
    <div
      className={['content-dialog', className].filter(Boolean).join(' ')}
      style={{
        '--dialog-avatar-size': `${dialog.avatarSize}px`,
        '--dialog-border-width': `${dialog.borderWidth}px`,
        '--dialog-radius': `${dialog.radius}px`,
        '--dialog-bubble-bg': dialog.bubbleColor || 'var(--color-surface)',
        '--dialog-bubble-border': dialog.borderColor || 'var(--color-primary)',
        '--dialog-text-align': dialog.textAlign,
      }}
    >
      {dialog.lines.map((line) => {
        const layout = getDialogLineLayout(line);

        return (
          <div key={line.id} className={`content-dialog__item content-dialog__item--${layout.side}`}>
            <div className="content-dialog__line" data-position={layout.position}>
              <DialogAvatar line={line} />

              <div className="content-dialog__speech">
                <p className="content-dialog__bubble" data-tail={getDialogTail(dialog, line)}>
                  {line.text ? (
                    <RichText
                      value={line.text}
                      notes={notes}
                      links={links}
                      field="text"
                      refId={line.id}
                      numberById={numberById}
                      onLinkClick={onLinkClick}
                    />
                  ) : (
                    <span className="content-dialog__placeholder">Текст реплики появится здесь.</span>
                  )}
                </p>

                {line.character && <span className="content-dialog__name">{line.character}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
