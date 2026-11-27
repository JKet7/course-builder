import { create } from 'zustand';
import api, { checkApi, errorKindOf, getErrorMessage } from '../api/axios.js';
import { DEFAULT_SETTINGS } from '../utils/testRun.js';
import { movedIds } from '../utils/helpers.js';

const EMPTY = {
  blockId: null,
  groups: [],
  sections: [],
  settings: DEFAULT_SETTINGS,
  questions: [],
  loading: false,
  loaded: false,
  error: null,
  /** Характер ошибки загрузки: offline | server | request (см. api/axios.js) */
  errorKind: null,
};


/**
 * Группы, разделы, настройки и вопросы блока «Тест» (Шаг 11 + ветвление).
 * Счётчики вопросов в группах компонент считает сам по списку questions,
 * поэтому стор не хранит отдельные counters.
 */
export const useTestStore = create((set, get) => ({
  ...EMPTY,

  /** GET /test-groups + /test-sections + /test-settings + /questions */
  fetchAll: async (blockId) => {
    set({ loading: true, error: null, errorKind: null });

    try {
      // Сначала один дешёвый запрос: живы ли API и база (см. checkApi).
      // Иначе при перезапуске сервера все четыре запроса ниже падают и
      // повторяются — консоль браузера заполняется красными «503».
      await checkApi();

      const [groupsRes, sectionsRes, settingsRes, questionsRes] = await Promise.all([
        api.get('/test-groups', { params: { blockId } }),
        api.get('/test-sections', { params: { blockId } }),
        api.get('/test-settings', { params: { blockId } }),
        api.get('/questions', { params: { blockId } }),
      ]);

      const groups = groupsRes.data.groups ?? [];
      const sections = sectionsRes.data.sections ?? [];
      const settings = { ...DEFAULT_SETTINGS, ...(settingsRes.data.settings ?? {}) };
      const questions = questionsRes.data.questions ?? [];

      set({ blockId, groups, sections, settings, questions, loading: false, loaded: true, error: null, errorKind: null });
      return { groups, sections, settings, questions };
    } catch (error) {
      set({
        ...EMPTY,
        blockId,
        loading: false,
        loaded: true,
        error: getErrorMessage(error, 'Не удалось загрузить тест'),
        errorKind: errorKindOf(error),
      });
      return null;
    }
  },


  reset: () => set({ ...EMPTY }),

  /** POST /test-groups */
  addGroup: async (blockId, name = 'Новая группа') => {
    try {
      const { data } = await api.post('/test-groups', { blockId, name });
      set({ groups: [...get().groups, data.group] });
      return { ok: true, group: data.group };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить группу') };
    }
  },

  /** PUT /test-groups/:id */
  updateGroup: async (groupId, name) => {
    try {
      const { data } = await api.put(`/test-groups/${groupId}`, { name });
      set({
        groups: get().groups.map((group) => (group.id === groupId ? data.group : group)),
        questions: get().questions.map((question) =>
          question.groupId === groupId ? { ...question, group: { id: data.group.id, name: data.group.name } } : question,
        ),
      });
      return { ok: true, group: data.group };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось переименовать группу') };
    }
  },

  /** DELETE /test-groups/:id — вопросы остаются в блоке без группы */
  deleteGroup: async (groupId) => {
    try {
      await api.delete(`/test-groups/${groupId}`);
      set({
        groups: get().groups.filter((group) => group.id !== groupId),
        questions: get().questions.map((question) =>
          question.groupId === groupId ? { ...question, groupId: null, group: null } : question,
        ),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить группу') };
    }
  },

  /** PUT /test-groups/reorder */
  reorderGroups: async (blockId, orderedIds) => {
    try {
      const { data } = await api.put('/test-groups/reorder', { blockId, orderedIds });
      set({ groups: data.groups });
      return { ok: true, groups: data.groups };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок групп') };
    }
  },

  moveGroup: (blockId, groupId, delta) => {
    const ids = movedIds(get().groups.map((group) => group.id), groupId, delta);
    return ids ? get().reorderGroups(blockId, ids) : Promise.resolve({ ok: false });
  },

  /** POST /test-sections */
  addSection: async (blockId, title = 'Новый раздел') => {
    try {
      const { data } = await api.post('/test-sections', { blockId, title });
      set({ sections: [...get().sections, data.section] });
      return { ok: true, section: data.section };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось добавить раздел') };
    }
  },

  /** PUT /test-sections/:id — название и итоговый комментарий */
  updateSection: async (sectionId, patch) => {
    try {
      const { data } = await api.put(`/test-sections/${sectionId}`, patch);
      set({ sections: get().sections.map((section) => (section.id === sectionId ? data.section : section)) });
      return { ok: true, section: data.section };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить раздел') };
    }
  },

  /** DELETE /test-sections/:id — вопросы и переходы остаются без раздела */
  deleteSection: async (sectionId) => {
    try {
      await api.delete(`/test-sections/${sectionId}`);
      set({
        sections: get().sections.filter((section) => section.id !== sectionId),
        questions: get().questions.map((question) => ({
          ...question,
          sectionId: question.sectionId === sectionId ? null : question.sectionId,
          section: question.sectionId === sectionId ? null : question.section,
          options: (question.options ?? []).map((option) =>
            option.targetSectionId === sectionId
              ? { ...option, targetType: 'next', targetSectionId: null }
              : option,
          ),
        })),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить раздел') };
    }
  },

  /** PUT /test-sections/reorder */
  reorderSections: async (blockId, orderedIds) => {
    try {
      const { data } = await api.put('/test-sections/reorder', { blockId, orderedIds });
      set({ sections: data.sections });
      return { ok: true, sections: data.sections };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок разделов') };
    }
  },

  moveSection: (blockId, sectionId, delta) => {
    const ids = movedIds(get().sections.map((section) => section.id), sectionId, delta);
    return ids ? get().reorderSections(blockId, ids) : Promise.resolve({ ok: false });
  },

  /** PUT /test-settings — тумблеры перемешивания и режим ветвления */
  saveSettings: async (blockId, patch) => {
    const next = { ...get().settings, ...patch };

    try {
      const { data } = await api.put('/test-settings', { blockId, ...patch });
      set({ settings: { ...DEFAULT_SETTINGS, ...data.settings } });
      return { ok: true, settings: data.settings };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось сохранить настройки теста'), settings: next };
    }
  },

  /** POST /questions */
  addQuestion: async (blockId, payload) => {
    try {
      const { data } = await api.post('/questions', { blockId, ...payload });
      set({ questions: [...get().questions, data.question] });
      return { ok: true, question: data.question };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось добавить вопрос'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** PUT /questions/:id — сервер заменяет варианты и пары целиком */
  updateQuestion: async (questionId, payload) => {
    try {
      const { data } = await api.put(`/questions/${questionId}`, payload);
      set({ questions: get().questions.map((question) => (question.id === questionId ? data.question : question)) });
      return { ok: true, question: data.question };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, 'Не удалось сохранить вопрос'),
        fieldErrors: error?.response?.data?.errors ?? null,
      };
    }
  },

  /** POST /questions/:id/duplicate — копия встаёт сразу после оригинала */
  duplicateQuestion: async (blockId, questionId) => {
    try {
      const { data } = await api.post(`/questions/${questionId}/duplicate`);
      // Сервер сдвинул order у следующих вопросов — перечитываем список целиком.
      await get().fetchAll(blockId);
      return { ok: true, question: data.question };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось дублировать вопрос') };
    }
  },

  /** DELETE /questions/:id */
  deleteQuestion: async (questionId) => {
    try {
      await api.delete(`/questions/${questionId}`);
      set({ questions: get().questions.filter((question) => question.id !== questionId) });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось удалить вопрос') };
    }
  },

  /** PUT /questions/reorder */
  reorderQuestions: async (blockId, orderedIds) => {
    try {
      const { data } = await api.put('/questions/reorder', { blockId, orderedIds });
      set({ questions: data.questions });
      return { ok: true, questions: data.questions };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error, 'Не удалось изменить порядок вопросов') };
    }
  },

  moveQuestion: (blockId, questionId, delta) => {
    const ids = movedIds(get().questions.map((question) => question.id), questionId, delta);
    return ids ? get().reorderQuestions(blockId, ids) : Promise.resolve({ ok: false });
  },
}));
