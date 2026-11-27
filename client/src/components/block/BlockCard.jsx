import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import Menu from '../ui/Menu.jsx';
import BlockBadge from './BlockBadge.jsx';
import { getBlockContentLabel } from '../../utils/helpers.js';

/**
 * Подписи кнопки действия. Статус приходит из прогресса читателя
 * (`block.progress.status`); пока прогресс не начат, показываем «Начать».
 */
const ACTION_LABELS = {
  not_started: 'Начать',
  in_progress: 'Продолжить',
  completed: 'Сначала',
};

const ACTION_HINTS = {
  not_started: 'Открыть блок',
  in_progress: 'Продолжить с места остановки',
  completed: 'Открыть блок заново',
};

/**
 * Карточка блока в левой панели страницы курса.
 * block: { id, type, title, contentCount, progress?, checklistProgress? }
 * checklistProgress — в блоке есть сохранённые отметки чек-листа (Правка 10);
 * тогда показывается кнопка «Сначала», сбрасывающая прогресс.
 * onSelect — показать блок в превью (наведение и фокус);
 * onEdit/onDownload/onDuplicate/onDelete — действия редактора, без них меню скрыто.
 */
export default function BlockCard({
  block,
  active = false,
  onSelect,
  onEdit,
  onDownload,
  onDuplicate,
  onDelete,
  onResetChecklist,
}) {
  const progressActive = Boolean(block.checklistProgress);
  const status = block.progress?.status ?? (progressActive ? 'in_progress' : 'not_started');
  const action = ACTION_LABELS[status] ?? ACTION_LABELS.not_started;
  const hasMenu = Boolean(onEdit || onDownload || onDuplicate || onDelete);

  return (
    <article
      className={['block-item', active ? 'is-active' : ''].filter(Boolean).join(' ')}
      onMouseEnter={() => onSelect?.(block)}
    >
      <Link
        to={`/block/${block.id}`}
        className="block-item__main"
        onFocus={() => onSelect?.(block)}
        onClick={() => onSelect?.(block)}
      >
        <h3 className="block-item__title">{block.title}</h3>

        <span className="block-item__meta">
          <BlockBadge type={block.type} />
          <span className="block-item__count">{getBlockContentLabel(block.type, block.contentCount)}</span>
        </span>
      </Link>

      <div className="block-item__actions">
        {progressActive && onResetChecklist && (
          <button
            type="button"
            className="block-item__reset"
            title="Сбросить все отметки в чек-листах блока"
            onClick={onResetChecklist}
          >
            <Icon name="refresh" size={13} />
            Сначала
          </button>
        )}

        <Link className="block-item__action" to={`/block/${block.id}`} title={ACTION_HINTS[status]}>
          {action}
          <Icon name="chevronRight" size={14} />
        </Link>

        {hasMenu && (
          <Menu
            label="Действия с блоком"
            icon="more"
            align="right"
            items={[
              onEdit && { key: 'edit', label: 'Редактировать', icon: 'pencil', onClick: onEdit },
              onDownload && { key: 'download', label: 'Скачать', icon: 'download', onClick: onDownload },
              onDuplicate && { key: 'duplicate', label: 'Дублировать', icon: 'copy', onClick: onDuplicate },
              onDelete && { key: 'delete', label: 'Удалить', icon: 'trash', variant: 'danger', onClick: onDelete },
            ]}
          />
        )}
      </div>
    </article>
  );
}

