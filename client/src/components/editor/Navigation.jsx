import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';

/**
 * Кнопки «Назад / Вперёд» и счётчик слайдов.
 * index — с нуля, total — количество слайдов.
 */
export default function Navigation({ index = 0, total = 0, onPrev, onNext }) {
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  return (
    <div className="slide-nav">
      <Button variant="ghost" size="sm" onClick={onPrev} disabled={!hasPrev}>
        <Icon name="chevronLeft" size={16} />
        Назад
      </Button>

      <span className="slide-nav__counter">
        {total > 0 ? `${index + 1} / ${total}` : '0 / 0'}
      </span>

      <Button variant="ghost" size="sm" onClick={onNext} disabled={!hasNext}>
        Вперёд
        <Icon name="chevronRight" size={16} />
      </Button>
    </div>
  );
}
