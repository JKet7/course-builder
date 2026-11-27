import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Input } from '../components/ui/Input.jsx';
import { useAuthStore } from '../store/authStore.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const loginAsGuest = useAuthStore((state) => state.loginAsGuest);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [form, setForm] = useState({ login: '', password: '' });
  const [touched, setTouched] = useState({});
  const [guestLoading, setGuestLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (error) clearError();
  };

  const handleBlur = (event) => {
    setTouched((prev) => ({ ...prev, [event.target.name]: true }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched({ login: true, password: true });

    if (!form.login.trim() || !form.password) return;

    const user = await login({ login: form.login.trim(), password: form.password });
    if (user) {
      navigate(location.state?.from ?? '/', { replace: true });
    }
  };

  const handleGuest = async () => {
    setGuestLoading(true);
    const user = await loginAsGuest();
    setGuestLoading(false);

    if (user) {
      navigate(location.state?.from ?? '/', { replace: true });
    }
  };

  const loginError = touched.login && !form.login.trim() ? 'Введите логин' : undefined;
  const passwordError = touched.password && !form.password ? 'Введите пароль' : undefined;

  return (
    <div className="auth-layout">
      <aside className="auth-hero">
        <div className="auth-hero__brand">
          <Icon name="book" size={28} />
          <span>Конструктор курсов</span>
        </div>
        <p className="auth-hero__lead">
          Собирайте теорию, тесты, памятки и глоссарии в одном курсе, делитесь с учениками и печатайте
          материалы в один клик.
        </p>
        <ul className="auth-hero__list">
          <li>Блочная структура курса</li>
          <li>Редактор теории со слайдами</li>
          <li>Тесты, карточки, соответствия</li>
          <li>Экспорт и печать</li>
        </ul>
      </aside>

      <div className="auth-page">
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
          <header className="auth-card__head">
            <h1 className="auth-card__title">Вход</h1>
            <p className="auth-card__subtitle">Войдите, чтобы продолжить работу с курсами</p>
          </header>

          <Input
            label="Логин"
            name="login"
            value={form.login}
            onChange={handleChange}
            onBlur={handleBlur}
            error={loginError}
            autoComplete="username"
            autoFocus
          />

          <Input
            label="Пароль"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            onBlur={handleBlur}
            error={passwordError}
            autoComplete="current-password"
          />

          {error && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={16} />
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading}>
            {loading && !guestLoading ? 'Входим…' : 'Войти'}
          </Button>

          <div className="auth-card__divider">
            <span>или</span>
          </div>

          <Button variant="secondary" onClick={handleGuest} disabled={loading || guestLoading}>
            {guestLoading ? 'Открываем…' : 'Войти, как читатель'}
          </Button>

          <p className="auth-card__note">
            Режим чтения: материалы открываются для просмотра, без правки и удаления.
          </p>
        </form>
      </div>
    </div>
  );
}
