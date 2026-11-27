import Icon from '../ui/Icon.jsx';
import { getBlockBadgeColor, getBlockIcon, getBlockTypeLabel } from '../../utils/helpers.js';

/** Бейдж типа блока: «Теория», «Тест», «Памятка», «Глоссарий». */
export default function BlockBadge({ type, className = '' }) {
  const classes = ['badge', getBlockBadgeColor(type), className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      <Icon name={getBlockIcon(type)} size={14} />
      {getBlockTypeLabel(type)}
    </span>
  );
}
