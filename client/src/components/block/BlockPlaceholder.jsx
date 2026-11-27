import Icon from '../ui/Icon.jsx';
import { getBlockTypeLabel } from '../../utils/helpers.js';

/** Заглушка для блока, для которого нет редактора (неизвестный тип). */
export default function BlockPlaceholder({ block }) {
  return (
    <div className="empty-state empty-state--center">
      <Icon name="layers" size={32} />
      <p className="empty-state__title">Блок «{getBlockTypeLabel(block.type)}»</p>
      <p>Для этого типа блока нет редактора. Проверьте настройки блока.</p>
    </div>
  );
}
