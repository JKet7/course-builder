import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';

/**
 * Внутренние ссылки (Правка 6).
 *
 * Стор держит три вещи:
 * - карту курса для диалога ссылки (один запрос на курс, кешируется);
 * - поле обычного текста, на котором стоит курсор, — кнопка «Ссылка»
 *   на панели инструментов и Ctrl+K работают и в ячейке таблицы, и в Tiptap;
 * - историю переходов по внутренним ссылкам: из неё шапка показывает «← Назад».
 *
 * target: { token, field, refId, hasSelection, apply(link) } — регистрирует RichInput.
 * dialog: { mode: 'create' | 'edit', initial, apply(link), remove() } — открывает LinksGroup/RichInput.
 */
export const useLinkStore = create((set, get) => ({
  /** Курс, к которому относится открытый блок. */
  courseId: null,

  /** Дерево курса: { id, title, blocks: [{ id, type, title, items }] }. */
  map: null,
  mapLoading: false,
  mapError: null,

  /** Поле обычного текста, к которому сейчас относится кнопка «Ссылка». */
  target: null,

  /** Открытый диалог ссылки. */
  dialog: null,

  /** Переходы по внутренним ссылкам: [{ pathname, search }], не больше 20. */
  history: [],

  /** Блок открылся — запоминаем курс; карта другого курса сбрасывается. */
  setCourseId: (courseId) => {
    if (!courseId || get().courseId === courseId) return;
    set({ courseId, map: null, mapError: null, mapLoading: false });
  },

  /** GET /courses/:id/links */
  fetchMap: async (courseId) => {
    if (!courseId) return null;

    set({ mapLoading: true, mapError: null });

    try {
      const { data } = await api.get(`/courses/${courseId}/links`);
      set({ courseId, map: data.course ?? null, mapLoading: false, mapError: null });
      return data.course ?? null;
    } catch (error) {
      set({ mapLoading: false, mapError: getErrorMessage(error, 'Не удалось загрузить элементы курса') });
      return null;
    }
  },

  /** Карта нужна диалогу внутренней ссылки: грузим один раз на курс. */
  ensureMap: () => {
    const { courseId, map, mapLoading, mapError } = get();
    if (!courseId || map || mapLoading || mapError) return;
    get().fetchMap(courseId);
  },

  /** Повторить загрузку карты после ошибки. */
  reloadMap: () => {
    const { courseId } = get();
    set({ mapError: null });
    if (courseId) get().fetchMap(courseId);
  },

  openDialog: (dialog) => {
    if (!dialog) return;
    set({ dialog });
    get().ensureMap();
  },

  closeDialog: () => set({ dialog: null }),

  setTarget: (target) => {
    if (!target) return;
    set({ target });
  },

  /** Забыть цель, если она всё ещё принадлежит этому полю. */
  clearTarget: (token) => {
    if (get().target?.token === token) set({ target: null });
  },

  pushHistory: (entry) => {
    if (!entry) return;
    set({ history: [...get().history, entry].slice(-20) });
  },

  popHistory: () => {
    const history = get().history;
    if (history.length === 0) return null;
    set({ history: history.slice(0, -1) });
    return history[history.length - 1];
  },

  clearHistory: () => set({ history: [] }),
}));
