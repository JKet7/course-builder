import { create } from 'zustand';

/**
 * Активный редактор форматированного текста (Tiptap).
 *
 * Панель инструментов одна на блок: команды (жирный, списки, цвет и т. д.)
 * применяются к тому полю, в котором сейчас стоит курсор, — как в Word.
 * TiptapEditor сообщает о себе при монтировании и фокусе, а при
 * размонтировании освобождает ссылку, чтобы панель не держала
 * уничтоженный экземпляр.
 */
export const useEditorStore = create((set, get) => ({
  /** Экземпляр Tiptap, к которому подключена панель инструментов. */
  activeEditor: null,

  /** Сделать редактор активным (вызывается при фокусе и при монтировании). */
  setActiveEditor: (editor) => {
    if (!editor || editor.isDestroyed) return;
    if (get().activeEditor === editor) return;
    set({ activeEditor: editor });
  },

  /** Освободить редактор: панель снова ждёт фокуса на текстовом поле. */
  releaseEditor: (editor) => {
    if (get().activeEditor === editor) set({ activeEditor: null });
  },
}));
