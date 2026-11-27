import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';
import { importCourseArchive } from '../api/courseImport.js';

/**
 * Курсы: сервер — источник истины, стор хранит последнюю полученную коллекцию.
 * Порядок сортировки задаёт сервер (order asc).
 *
 * Мутации возвращают { ok: true, course } | { ok: false, message, fieldErrors },
 * чтобы модалки показывали ошибку у себя, а не в общем алерте страницы.
 */
export const useCourseStore = create((set, get) => ({
  courses: [],
  loading: false,
  error: null,
  loaded: false,

  /** Курс для страницы курса (GET /courses/:id) */
  currentCourse: null,
  courseLoading: false,
  courseError: null,
  courseNotFound: false,

  /** GET /courses (опционально ?search=) */
  fetchCourses: async (search = '') => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.get('/courses', { params: search ? { search } : undefined });
      set({ courses: data.courses, loading: false, loaded: true, error: null });
      return data.courses;
    } catch (error) {
      set({ loading: false, loaded: true, error: getErrorMessage(error, 'Не удалось загрузить курсы') });
      return null;
    }
  },

  /** GET /courses/:id — курс со списком блоков (для страницы курса) */
  fetchCourse: async (id) => {
    set({ courseLoading: true, courseError: null, courseNotFound: false });

    try {
      const { data } = await api.get(`/courses/${id}`);
      set({ currentCourse: data.course, courseLoading: false, courseError: null, courseNotFound: false });
      return { ok: true, course: data.course };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      const notFound = status === 404;

      set({
        currentCourse: null,
        courseLoading: false,
        courseNotFound: notFound,
        courseError: notFound ? null : getErrorMessage(error, 'Не удалось загрузить курс'),
      });

      return { ok: false, status, message: getErrorMessage(error, 'Не удалось загрузить курс') };
    }
  },

  /** POST /courses → курс добавляется в конец списка */
  addCourse: async ({ title, description }) => {
    try {
      const { data } = await api.post('/courses', { title, description });
      set({ courses: [...get().courses, data.course] });
      return { ok: true, course: data.course };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось создать курс'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** POST /courses/import — ZIP-архив курса (Шаг 13) */
  importCourse: async (file) => {
    const result = await importCourseArchive(file);
    if (!result.ok) return result;

    set({ courses: [...get().courses, result.course] });
    return result;
  },

  /** PUT /courses/:id */
  updateCourse: async (id, patch) => {
    try {
      const { data } = await api.put(`/courses/${id}`, patch);
      const current = get().currentCourse;

      set({
        courses: get().courses.map((course) => (course.id === id ? data.course : course)),
        currentCourse:
          current?.id === id ? { ...current, ...data.course, blocks: current.blocks ?? [] } : current,
      });

      return { ok: true, course: data.course };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось сохранить курс'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** DELETE /courses/:id */
  deleteCourse: async (id) => {
    try {
      await api.delete(`/courses/${id}`);
      set({
        courses: get().courses.filter((course) => course.id !== id),
        currentCourse: get().currentCourse?.id === id ? null : get().currentCourse,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить курс') };
    }
  },

  /** PUT /courses/reorder — порядок приходит с сервера */
  reorderCourses: async (orderedIds) => {
    try {
      const { data } = await api.put('/courses/reorder', { orderedIds });
      set({ courses: data.courses });
      return { ok: true, courses: data.courses };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок курсов') };
    }
  },

  clearError: () => set({ error: null }),
}));

