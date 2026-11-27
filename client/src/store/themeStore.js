import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';
import { applyTheme, resetTheme } from '../utils/themes.js';

// StrictMode и быстрые переходы не должны дублировать GET /themes
let inflight = null;

const colorsOf = (themes, themeId) => themes.find((theme) => theme.id === themeId)?.colors ?? null;

/**
 * Темы оформления (Шаг 12). Мутации возвращают { ok, message?, fieldErrors? },
 * как и остальные сторы, чтобы ошибки сервера попадали в форму.
 */
export const useThemeStore = create((set, get) => ({
  themes: [],
  activeThemeId: null,
  defaultThemeId: null,
  loading: false,
  loaded: false,
  error: null,
  saving: false,

  /** Тема, применённая сейчас */
  activeTheme: () => get().themes.find((theme) => theme.id === get().activeThemeId) ?? null,

  /** GET /themes — глобальные темы и личные темы пользователя */
  fetchThemes: async () => {
    if (inflight) return inflight;

    set({ loading: true, error: null });

    inflight = api
      .get('/themes')
      .then(({ data }) => {
        const themes = data.themes ?? [];
        set({
          themes,
          activeThemeId: data.activeThemeId ?? null,
          defaultThemeId: data.defaultThemeId ?? null,
          loading: false,
          loaded: true,
          error: null,
        });

        const colors = colorsOf(themes, data.activeThemeId);
        if (colors) applyTheme(colors);
        else resetTheme();

        return data;
      })
      .catch((error) => {
        set({ loading: false, loaded: true, error: getErrorMessage(error, 'Не удалось загрузить темы') });
        return null;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  },

  /** PUT /themes/active — выбрать тему (null → тема по умолчанию) */
  setActive: async (themeId) => {
    set({ saving: true });

    try {
      const { data } = await api.put('/themes/active', { themeId: themeId ?? null });
      const themes = get().themes.map((theme) => ({ ...theme, isActive: theme.id === data.themeId }));
      set({ saving: false, activeThemeId: data.themeId, themes });

      const colors = colorsOf(themes, data.themeId);
      if (colors) applyTheme(colors);
      else resetTheme();

      return { ok: true, themeId: data.themeId };
    } catch (error) {
      set({ saving: false });
      return { ok: false, message: getErrorMessage(error, 'Не удалось применить тему') };
    }
  },

  /** POST /themes */
  createTheme: async ({ name, colors, isGlobal = false }) => {
    try {
      const { data } = await api.post('/themes', { name, colors, isGlobal });
      set({ themes: [...get().themes, data.theme] });
      return { ok: true, theme: data.theme };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось создать тему'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** PUT /themes/:id */
  updateTheme: async (id, { name, colors }) => {
    try {
      const { data } = await api.put(`/themes/${id}`, { name, colors });
      set({ themes: get().themes.map((theme) => (theme.id === id ? data.theme : theme)) });

      if (get().activeThemeId === id) applyTheme(data.theme.colors);

      return { ok: true, theme: data.theme };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось сохранить тему'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** DELETE /themes/:id — если тема была активной, включаем глобальную по умолчанию */
  deleteTheme: async (id) => {
    try {
      await api.delete(`/themes/${id}`);

      const wasActive = get().activeThemeId === id;
      const themes = get().themes.filter((theme) => theme.id !== id);
      set({ themes });

      if (wasActive) {
        const next = themes.find((theme) => theme.isGlobal) ?? themes[0] ?? null;
        set({ activeThemeId: next?.id ?? null });
        if (next) applyTheme(next.colors);
        else resetTheme();
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить тему') };
    }
  },

  /** Выход из аккаунта: пустой стор и оформление по умолчанию */
  reset: () => {
    set({
      themes: [],
      activeThemeId: null,
      defaultThemeId: null,
      loading: false,
      loaded: false,
      error: null,
      saving: false,
    });
    resetTheme();
  },
}));
