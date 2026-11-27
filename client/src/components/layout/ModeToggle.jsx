import { useUiStore } from '../../store/uiStore.js';
import Icon from '../ui/Icon.jsx';

/**
 * Переключатель режима «чтение / редактирование» — одна иконка-кнопка.
 * Показывает текущий режим (book-open — чтение, pencil — редактор),
 * клик переключает на противоположный.
 */
export default function ModeToggle() {
  const uiMode = useUiStore((state) => state.uiMode);
  const toggleUiMode = useUiStore((state) => state.toggleUiMode);

  const isEdit = uiMode === 'edit';
  const label = isEdit ? 'Переключить в режим чтения' : 'Переключить в режим редактора';

  return (
    <button
      type="button"
      className="mode-toggle"
      title={label}
      aria-label={label}
      onClick={toggleUiMode}
    >
      <span className="mode-toggle__icons" aria-hidden="true">
        <Icon
          name="book"
          size={20}
          strokeWidth={2}
          className={isEdit ? 'mode-toggle__icon' : 'mode-toggle__icon is-visible'}
        />
        <Icon
          name="pencil"
          size={20}
          strokeWidth={2}
          className={isEdit ? 'mode-toggle__icon is-visible' : 'mode-toggle__icon'}
        />
      </span>
    </button>
  );
}
