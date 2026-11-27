import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';

/**
 * Справка о блоке (Правка 7).
 *
 * Данные не кешируются: примечания и обратные ссылки могли измениться, пока
 * модалка закрыта, поэтому каждый показ — новый GET /blocks/:id/help.
 * Ответ для другого блока (быстрое переключение) отбрасываем по blockId.
 */
export const useHelpStore = create((set, get) => ({
  /** Блок, для которого загружены (или грузятся) данные. */
  blockId: null,

  /** Ответ сервера: { block, updatedAt, notes, mentions, totals } | null */
  help: null,
  loading: false,
  error: null,

  fetchHelp: async (blockId) => {
    if (!blockId) return null;

    set({ blockId, loading: true, error: null, help: null });

    try {
      const { data } = await api.get(`/blocks/${blockId}/help`);
      if (get().blockId !== blockId) return null;

      set({ help: data.help ?? null, loading: false, error: null });
      return data.help ?? null;
    } catch (error) {
      if (get().blockId !== blockId) return null;

      set({ help: null, loading: false, error: getErrorMessage(error, 'Не удалось загрузить справку') });
      return null;
    }
  },

  /** Модалка закрылась — забываем данные блока. */
  reset: () => set({ blockId: null, help: null, loading: false, error: null }),
}));
