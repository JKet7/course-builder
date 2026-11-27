import { create } from 'zustand';
import api, { TOKEN_KEY, USER_KEY, getErrorMessage } from '../api/axios.js';

export const EDITOR_ROLES = ['admin', 'editor'];

const isEditorRole = (role) => EDITOR_ROLES.includes(role);

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const storedToken = localStorage.getItem(TOKEN_KEY);
const storedUser = readStoredUser();

export const useAuthStore = create((set, get) => ({
  token: storedToken,
  user: storedUser,
  isAuthenticated: Boolean(storedToken),
  isEditor: isEditorRole(storedUser?.role),
  loading: false,
  error: null,

  /** POST /auth/login → токен + пользователь в localStorage. */
  login: async ({ login, password }) => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.post('/auth/login', { login, password });
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));

      set({
        token: data.token,
        user: data.user,
        isAuthenticated: true,
        isEditor: isEditorRole(data.user.role),
        loading: false,
        error: null,
      });

      return data.user;
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error, 'Не удалось войти') });
      return null;
    }
  },

  /** POST /auth/guest → сессия «только чтение» без логина и пароля. */
  loginAsGuest: async () => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.post('/auth/guest');
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));

      set({
        token: data.token,
        user: data.user,
        isAuthenticated: true,
        isEditor: false,
        loading: false,
        error: null,
      });

      return data.user;
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error, 'Не удалось войти в режим чтения') });
      return null;
    }
  },

  /** Выход: токен stateless, поэтому просто чистим клиент. */
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isEditor: false,
      loading: false,
      error: null,
    });
  },

  /** Восстановление сессии: проверяем токен через GET /auth/me. */
  restore: async () => {
    const token = get().token;
    if (!token) return null;

    try {
      const { data } = await api.get('/auth/me');
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      set({ user: data.user, isAuthenticated: true, isEditor: isEditorRole(data.user.role) });
      return data.user;
    } catch {
      get().logout();
      return null;
    }
  },

  clearError: () => set({ error: null }),
}));
