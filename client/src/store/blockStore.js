import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';
import { importBlockFile } from '../api/blockTransfer.js';

/**
 * Блоки активного курса. Стор помнит courseId, чтобы не смешивать списки
 * при переходе между курсами.
 *
 * Мутации возвращают { ok: true, block } | { ok: false, message, fieldErrors }.
 */
export const useBlockStore = create((set, get) => ({
  blocks: [],
  courseId: null,
  loading: false,
  loaded: false,
  error: null,

  /** Блок для страницы /block/:id (загружается отдельно от списка курса) */
  currentBlock: null,
  blockLoading: false,
  blockError: null,
  blockNotFound: false,

  /** GET /blocks/:id */
  fetchBlock: async (id) => {
    set({ blockLoading: true, blockError: null, blockNotFound: false });

    try {
      const { data } = await api.get(`/blocks/${id}`);
      set({ currentBlock: data.block, blockLoading: false, blockError: null, blockNotFound: false });
      return data.block;
    } catch (error) {
      const notFound = error?.response?.status === 404;
      set({
        currentBlock: null,
        blockLoading: false,
        blockError: notFound ? null : getErrorMessage(error, 'Не удалось загрузить блок'),
        blockNotFound: notFound,
      });
      return null;
    }
  },

  /** GET /blocks?courseId= */
  fetchBlocks: async (courseId) => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.get('/blocks', { params: { courseId } });
      set({ blocks: data.blocks, courseId, loading: false, loaded: true, error: null });
      return data.blocks;
    } catch (error) {
      set({
        blocks: [],
        courseId,
        loading: false,
        loaded: true,
        error: getErrorMessage(error, 'Не удалось загрузить блоки'),
      });
      return null;
    }
  },

  /** POST /blocks → блок появляется в конце списка */
  addBlock: async (payload) => {
    try {
      const { data } = await api.post('/blocks', payload);
      set({ blocks: [...get().blocks, data.block] });
      return { ok: true, block: data.block };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось создать блок'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** PUT /blocks/:id */
  updateBlock: async (id, patch) => {
    try {
      const { data } = await api.put(`/blocks/${id}`, patch);
      set({
        blocks: get().blocks.map((block) => (block.id === id ? data.block : block)),
        currentBlock: get().currentBlock?.id === id ? data.block : get().currentBlock,
      });
      return { ok: true, block: data.block };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось сохранить блок'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** DELETE /blocks/:id */
  deleteBlock: async (id) => {
    try {
      await api.delete(`/blocks/${id}`);
      set({
        blocks: get().blocks.filter((block) => block.id !== id),
        currentBlock: get().currentBlock?.id === id ? null : get().currentBlock,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить блок') };
    }
  },

  /** PUT /blocks/reorder — порядок приходит с сервера */
  reorderBlocks: async (courseId, orderedIds) => {
    try {
      const { data } = await api.put('/blocks/reorder', { courseId, orderedIds });
      set({ blocks: data.blocks });
      return { ok: true, blocks: data.blocks };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок блоков') };
    }
  },

  /** POST /blocks/:id/duplicate — копия появляется в конце списка */
  duplicateBlock: async (id) => {
    try {
      const { data } = await api.post(`/blocks/${id}/duplicate`);
      set({ blocks: [...get().blocks, data.block] });
      return { ok: true, block: data.block };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось дублировать блок') };
    }
  },

  /** POST /blocks/import — блок из файла блока (JSON/ZIP) появляется в конце списка */
  importBlock: async (courseId, file) => {
    const result = await importBlockFile(courseId, file);
    if (!result.ok) return result;

    set({ blocks: [...get().blocks, result.block] });
    return result;
  },
}));
