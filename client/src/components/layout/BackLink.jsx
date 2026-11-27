import { useNavigate } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { useLinkStore } from '../../store/linkStore.js';

/**
 * Кнопка «← Назад» после перехода по внутренней ссылке (Правка 6).
 * История хранится в linkStore: браузерная кнопка «назад» вернула бы
 * на предыдущую страницу, а нам нужно именно место, откуда ушли по ссылке.
 */
export default function BackLink() {
  const history = useLinkStore((state) => state.history);
  const navigate = useNavigate();

  if (history.length === 0) return null;

  const target = history[history.length - 1];

  const goBack = () => {
    useLinkStore.getState().popHistory();
    navigate(`${target.pathname}${target.search ?? ''}`);
  };

  return (
    <button type="button" className="app-header__back" title="Вернуться к месту перехода" onClick={goBack}>
      <Icon name="arrowLeft" size={16} />
      Назад
    </button>
  );
}
