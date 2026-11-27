import { create } from 'zustand';

/**
 * Поле обычного текста, в котором можно оставить примечание (Правка 5).
 *
 * Tiptap-поля подключаются к панели через editorStore, а ячейки таблицы,
 * пункты чек-листа, подписи и реплики — через этот стор: RichInput
 * регистрирует цель при фокусе/выделении, NoteGroup (панель инструментов)
 * открывает то же всплывающее поле, что и для текста.
 *
 * target: { token, field, refId, anchor, hasSelection, create(text) }
 */
export const useNoteStore = create((set, get) => ({
  /** Поле, к которому сейчас относится кнопка «Примечание». */
  target: null,

  setTarget: (target) => {
    if (!target) return;
    set({ target });
  },

  /** Забыть цель, если она всё ещё принадлежит этому полю. */
  clearTarget: (token) => {
    if (get().target?.token === token) set({ target: null });
  },
}));
