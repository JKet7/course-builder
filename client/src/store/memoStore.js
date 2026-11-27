import { create } from 'zustand';
import api, { getErrorMessage } from '../api/axios.js';
import { movedIds } from '../utils/helpers.js';

const EMPTY = {
  blockId: null,
  slides: [],
  activeSlideId: null,
  loading: false,
  loaded: false,
  error: null,
};

/** Слайд, который видно сейчас: сохранённый либо первый в списке. */
const pickActiveSlideId = (slides, preferredId) => {
  if (preferredId && slides.some((slide) => slide.id === preferredId)) return preferredId;
  return slides[0]?.id ?? null;
};

/** Заменяет слайд в списке, сохраняя порядок остальных. */
const replaceSlide = (slides, next) => slides.map((slide) => (slide.id === next.id ? next : slide));

/** Меняет карточку во вложенном списке слайдов. */
const replaceCell = (slides, cell) =>
  slides.map((slide) =>
    slide.cells.some((item) => item.id === cell.id)
      ? { ...slide, cells: slide.cells.map((item) => (item.id === cell.id ? cell : item)) }
      : slide,
  );

/**
 * Слайды и карточки блока «Памятка» (Шаг 11).
 *
 * Слайд — верхний уровень: заголовок и своя сетка карточек. Карточка
 * (MemoCell) осталась прежней: заголовок и тело из фрагментов контента.
 * На экране всегда один слайд, остальные доступны из содержания справа
 * (`activeSlideId`).
 */
export const useMemoStore = create((set, get) => ({
  ...EMPTY,

  /** GET /memo-slides?blockId= */
  fetchSlides: async (blockId) => {
    set({ loading: true, error: null });

    try {
      const { data } = await api.get('/memo-slides', { params: { blockId } });
      const slides = data.slides ?? [];
      set({
        blockId,
        slides,
        activeSlideId: pickActiveSlideId(slides, get().activeSlideId),
        loading: false,
        loaded: true,
        error: null,
      });
      return slides;
    } catch (error) {
      set({ ...EMPTY, blockId, loading: false, loaded: true, error: getErrorMessage(error, 'Не удалось загрузить памятку') });
      return null;
    }
  },

  reset: () => set({ ...EMPTY }),

  /** Открыть слайд по id. */
  setActiveSlide: (slideId) => set({ activeSlideId: slideId }),

  /** POST /memo-slides — новый слайд сразу с одной пустой карточкой */
  addSlide: async (blockId) => {
    try {
      const { data } = await api.post('/memo-slides', { blockId });
      set({ slides: [...get().slides, data.slide], activeSlideId: data.slide.id });
      return { ok: true, slide: data.slide };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить слайд') };
    }
  },

  /** PUT /memo-slides/:id */
  updateSlide: async (slideId, patch) => {
    try {
      const { data } = await api.put(`/memo-slides/${slideId}`, patch);
      set({ slides: replaceSlide(get().slides, data.slide) });
      return { ok: true, slide: data.slide };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить слайд') };
    }
  },

  /** DELETE /memo-slides/:id — карточки удаляются вместе со слайдом */
  deleteSlide: async (slideId) => {
    try {
      await api.delete(`/memo-slides/${slideId}`);
      const slides = get().slides;
      const index = slides.findIndex((slide) => slide.id === slideId);
      const rest = slides.filter((slide) => slide.id !== slideId);
      const activeSlideId =
        get().activeSlideId === slideId
          ? rest[Math.min(index < 0 ? rest.length : index, rest.length - 1)]?.id ?? null
          : get().activeSlideId;

      set({ slides: rest, activeSlideId });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить слайд') };
    }
  },

  /** PUT /memo-slides/reorder */
  reorderSlides: async (blockId, orderedIds) => {
    try {
      const { data } = await api.put('/memo-slides/reorder', { blockId, orderedIds });
      set({ slides: data.slides, activeSlideId: pickActiveSlideId(data.slides, get().activeSlideId) });
      return { ok: true, slides: data.slides };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок слайдов') };
    }
  },

  moveSlide: (blockId, slideId, delta) => {
    const ids = movedIds(get().slides.map((slide) => slide.id), slideId, delta);
    return ids ? get().reorderSlides(blockId, ids) : Promise.resolve({ ok: false });
  },

  /** POST /memo-cells — карточка в конкретном слайде */
  addCell: async (blockId, slideId) => {
    try {
      const { data } = await api.post('/memo-cells', { blockId, slideId });
      set({
        slides: get().slides.map((slide) =>
          slide.id === slideId ? { ...slide, cells: [...slide.cells, data.cell] } : slide,
        ),
      });
      return { ok: true, cell: data.cell };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить карточку') };
    }
  },

  /** PUT /memo-cells/:id */
  updateCell: async (cellId, patch) => {
    try {
      const { data } = await api.put(`/memo-cells/${cellId}`, patch);
      set({ slides: replaceCell(get().slides, data.cell) });
      return { ok: true, cell: data.cell };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить карточку') };
    }
  },

  /** DELETE /memo-cells/:id */
  deleteCell: async (cellId) => {
    try {
      await api.delete(`/memo-cells/${cellId}`);
      set({
        slides: get().slides.map((slide) => ({
          ...slide,
          cells: slide.cells.filter((cell) => cell.id !== cellId),
        })),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить карточку') };
    }
  },

  /** PUT /memo-cells/reorder — порядок карточек внутри слайда */
  reorderCells: async (blockId, slideId, orderedIds) => {
    try {
      const { data } = await api.put('/memo-cells/reorder', { blockId, slideId, orderedIds });
      set({
        slides: get().slides.map((slide) => (slide.id === slideId ? { ...slide, cells: data.cells } : slide)),
      });
      return { ok: true, cells: data.cells };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок карточек') };
    }
  },

  moveCell: (blockId, slideId, cellId, delta) => {
    const slide = get().slides.find((item) => item.id === slideId);
    const ids = slide ? movedIds(slide.cells.map((cell) => cell.id), cellId, delta) : null;
    return ids ? get().reorderCells(blockId, slideId, ids) : Promise.resolve({ ok: false });
  },
}));
