import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';

/**
 * Печатная версия курса (Шаг 15).
 *
 * Данные приходят одним запросом `GET /courses/:id/print` (read-model на сервере),
 * поэтому страница печати не зависит от редакторов блоков и их сторов.
 * `showAnswers` — переключатель «показывать ответы теста» на странице.
 */
export const usePrintStore = create((set) => ({
  course: null,
  generatedAt: null,
  loading: false,
  loaded: false,
  error: null,
  notFound: false,
  showAnswers: true,

  /** GET /courses/:id/print */
  fetchPrintCourse: async (id) => {
    set({ loading: true, error: null, notFound: false });

    try {
      const { data } = await api.get(`/courses/${id}/print`);
      set({
        course: data.course,
        generatedAt: data.generatedAt,
        loading: false,
        loaded: true,
        error: null,
        notFound: false,
      });
      return { ok: true, course: data.course };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      const notFound = status === 404;

      set({
        course: null,
        generatedAt: null,
        loading: false,
        loaded: true,
        notFound,
        error: notFound ? null : getErrorMessage(error, 'Не удалось подготовить документ'),
      });

      return { ok: false, status, message: getErrorMessage(error, 'Не удалось подготовить документ') };
    }
  },

  setShowAnswers: (value) => set({ showAnswers: Boolean(value) }),

  /** Сброс при уходе со страницы, чтобы не печатать данные прошлого курса. */
  reset: () => set({ course: null, generatedAt: null, loading: false, loaded: false, error: null, notFound: false }),
}));
