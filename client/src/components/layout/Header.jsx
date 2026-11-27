import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { useBlockStore } from '../../store/blockStore.js';
import { useUiStore } from '../../store/uiStore.js';
import Icon from '../ui/Icon.jsx';
import BackLink from './BackLink.jsx';
import EditorOnly from './EditorOnly.jsx';
import ModeToggle from './ModeToggle.jsx';

const ROLE_LABELS = {
  admin: 'Администратор',
  editor: 'Редактор',
  reader: 'Читатель',
};

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isEditor = useAuthStore((state) => state.isEditor);
  const logout = useAuthStore((state) => state.logout);

  const currentBlock = useBlockStore((state) => state.currentBlock);
  const openModal = useUiStore((state) => state.openModal);

  // currentBlock остаётся в сторе и после ухода со страницы блока — сверяем id из адреса
  const blockId = location.pathname.startsWith('/block/') ? location.pathname.split('/')[2] ?? '' : '';
  const block = blockId && currentBlock?.id === blockId ? currentBlock : null;

  const headerRef = useRef(null);

  /*
   * Шапка закреплена (position: sticky), а панели содержания и инструментов
   * отступают от верха ровно на её высоту (--app-header-h). Высоту не задаём
   * константой: на узком экране шапка переносится на две строки и становится
   * выше. ResizeObserver обновляет переменную при изменении ширины окна.
   */
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;

    const applyHeight = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty('--app-header-h', `${height}px`);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="app-header" ref={headerRef}>
      <BackLink />

      <Link to="/" className="app-header__brand">
        Конструктор курсов
      </Link>

      <nav className="app-header__nav">
        <Link to="/">Курсы</Link>
      </nav>

      <div className="app-header__right">
        {/* Правка 7: темы, настройки блока и справка — в правом верхнем углу */}
        <div className="app-header__tools">
          <Link to="/themes" className="app-header__tool" title="Темы оформления" aria-label="Темы оформления">
            <Icon name="palette" size={17} />
          </Link>

          {block && isEditor && (
            <button
              type="button"
              className="app-header__tool"
              title="Настройки блока"
              aria-label="Настройки блока"
              onClick={() => openModal('block-edit', block)}
            >
              <Icon name="settings" size={17} />
            </button>
          )}

          {block && (
            <button
              type="button"
              className="app-header__tool app-header__tool--help"
              title="Справка о блоке"
              aria-label="Справка о блоке"
              onClick={() => openModal('block-help', block)}
            >
              <Icon name="help" size={17} />
            </button>
          )}
        </div>

        <EditorOnly>
          <ModeToggle />
        </EditorOnly>

        {user && (
          <span className="app-header__user" title={user.login}>
            {user.login}
            <span className="app-header__role">{ROLE_LABELS[user.role] ?? user.role}</span>
          </span>
        )}

        <button type="button" className="btn btn--ghost" onClick={handleLogout}>
          Выйти
        </button>
      </div>
    </header>
  );
}
