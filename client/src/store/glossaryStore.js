import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';

const EMPTY = { blockId: null, terms: [], loading: false, loaded: false, error: null };

/** Термины блока «Глоссарий» (Шаг 11). Сортировку по алфавиту делает компонент. */
export const useGlossaryStore = create((set, get) => ({
  ...EMPTY,

  /** GET /terms?blockId= */
  fetchTerms: async (blockId) => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.get('/terms', { params: { blockId } });
      set({ blockId, terms: data.terms ?? [], loading: false, loaded: true, error: null });
      return data.terms ?? [];
    } catch (error) {
      set({ ...EMPTY, blockId, loading: false, loaded: true, error: getErrorMessage(error, 'Не удалось загрузить глоссарий') });
      return null;
    }
  },

  reset: () => set({ ...EMPTY }),

  /** POST /terms */
  addTerm: async (blockId, term, definition) => {
    try {
      const { data } = await api.post('/terms', { blockId, term, definition });
      set({ terms: [...get().terms, data.term] });
      return { ok: true, term: data.term };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить термин') };
    }
  },

  /** PUT /terms/:id */
  updateTerm: async (termId, patch) => {
    try {
      const { data } = await api.put(`/terms/${termId}`, patch);
      set({ terms: get().terms.map((term) => (term.id === termId ? data.term : term)) });
      return { ok: true, term: data.term };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить термин') };
    }
  },

  /** DELETE /terms/:id */
  deleteTerm: async (termId) => {
    try {
      await api.delete(`/terms/${termId}`);
      set({ terms: get().terms.filter((term) => term.id !== termId) });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить термин') };
    }
  },

  /** POST /terms/bulk — импорт CSV одной транзакцией */
  importTerms: async (blockId, items) => {
    try {
      const { data } = await api.post('/terms/bulk', { blockId, terms: items });
      set({ terms: [...get().terms, ...(data.terms ?? [])] });
      return { ok: true, created: data.created ?? 0 };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось импортировать термины'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },
}));
