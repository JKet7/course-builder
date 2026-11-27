import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';

/** Обновляет один слайд в массиве, не трогая остальные. */
const patchSlide = (slides, slideId, updater) =>
  slides.map((slide) => (slide.id === slideId ? updater(slide) : slide));

/**
 * Слайды активного блока «Теория» и их контент.
 * Слайды приходят с сервера вместе с contents, поэтому отдельный запрос
 * за контентом не нужен (GET /slides отдаёт всё сразу).
 *
 * Мутации возвращают { ok: true, ... } | { ok: false, message, fieldErrors }.
 */
export const useContentStore = create((set, get) => ({
  blockId: null,
  slides: [],
  activeSlideId: null,
  loading: false,
  loaded: false,
  error: null,

  /** GET /slides?blockId= */
  fetchSlides: async (blockId) => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.get('/slides', { params: { blockId } });
      const slides = data.slides ?? [];
      const current = get().activeSlideId;
      const activeSlideId = slides.some((slide) => slide.id === current) ? current : slides[0]?.id ?? null;

      set({ slides, blockId, activeSlideId, loading: false, loaded: true, error: null });
      return slides;
    } catch (error) {
      set({
        slides: [],
        blockId,
        activeSlideId: null,
        loading: false,
        loaded: true,
        error: getErrorMessage(error, 'Не удалось загрузить слайды'),
      });
      return null;
    }
  },

  /** Сброс при уходе со страницы другого блока. */
  reset: () => set({ blockId: null, slides: [], activeSlideId: null, loading: false, loaded: false, error: null }),

  setActiveSlide: (slideId) => set({ activeSlideId: slideId }),

  /** POST /slides — новый слайд в конце, сразу открываем его */
  addSlide: async (blockId, title = '') => {
    try {
      const { data } = await api.post('/slides', { blockId, title });
      set({ slides: [...get().slides, data.slide], activeSlideId: data.slide.id });
      return { ok: true, slide: data.slide };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить слайд') };
    }
  },

  /** PUT /slides/:id — название слайда */
  updateSlide: async (slideId, title) => {
    try {
      const { data } = await api.put(`/slides/${slideId}`, { title });
      set({ slides: patchSlide(get().slides, slideId, () => data.slide) });
      return { ok: true, slide: data.slide };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить слайд') };
    }
  },

  /** DELETE /slides/:id — контент удаляется каскадом */
  deleteSlide: async (slideId) => {
    try {
      await api.delete(`/slides/${slideId}`);

      const slides = get().slides.filter((slide) => slide.id !== slideId);
      const activeSlideId = get().activeSlideId === slideId ? slides[0]?.id ?? null : get().activeSlideId;
      set({ slides, activeSlideId });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить слайд') };
    }
  },

  /** PUT /slides/reorder */
  reorderSlides: async (blockId, orderedIds) => {
    try {
      const { data } = await api.put('/slides/reorder', { blockId, orderedIds });
      set({ slides: data.slides });
      return { ok: true, slides: data.slides };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок слайдов') };
    }
  },

  /** POST /contents — новый фрагмент в конец слайда */
  addContent: async (slideId, type, options = {}) => {
    try {
      const { data } = await api.post('/contents', { slideId, type, ...options });
      const content = data.content;

      set({
        slides: patchSlide(get().slides, slideId, (slide) => ({
          ...slide,
          contents: [...slide.contents, content],
          contentCount: (slide.contentCount ?? slide.contents.length) + 1,
        })),
      });

      return { ok: true, content };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось добавить контент'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** PUT /contents/:id — data и/или width */
  updateContent: async (slideId, contentId, patch) => {
    try {
      const { data } = await api.put(`/contents/${contentId}`, patch);

      set({
        slides: patchSlide(get().slides, slideId, (slide) => ({
          ...slide,
          contents: slide.contents.map((content) => (content.id === contentId ? data.content : content)),
        })),
      });

      return { ok: true, content: data.content };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить контент') };
    }
  },

  /** DELETE /contents/:id */
  deleteContent: async (slideId, contentId) => {
    try {
      await api.delete(`/contents/${contentId}`);

      set({
        slides: patchSlide(get().slides, slideId, (slide) => ({
          ...slide,
          contents: slide.contents.filter((content) => content.id !== contentId),
          contentCount: Math.max(0, (slide.contentCount ?? slide.contents.length) - 1),
        })),
      });

      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить контент') };
    }
  },

  /** PUT /contents/reorder — порядок приходит с сервера */
  reorderContents: async (slideId, orderedIds) => {
    try {
      const { data } = await api.put('/contents/reorder', { slideId, orderedIds });
      set({ slides: patchSlide(get().slides, slideId, (slide) => ({ ...slide, contents: data.contents })) });
      return { ok: true, contents: data.contents };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок контента') };
    }
  },
}));
