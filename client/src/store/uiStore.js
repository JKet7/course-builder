import { create } from 'zustand';

export const useUiStore = create((set, get) => ({
  /**
   * Режим интерфейса: 'view' | 'edit'. Доступен только admin/editor.
   * Между сессиями не сохраняется — при загрузке всегда режим чтения.
   */
  uiMode: 'view',

  /** Активная модалка: { name, payload } | null */
  modal: null,

  setUiMode: (mode) => set({ uiMode: mode === 'edit' ? 'edit' : 'view' }),

  toggleUiMode: () => set({ uiMode: get().uiMode === 'edit' ? 'view' : 'edit' }),

  isEditMode: () => get().uiMode === 'edit',

  openModal: (name, payload = null) => set({ modal: { name, payload } }),
  closeModal: () => set({ modal: null }),
}));
