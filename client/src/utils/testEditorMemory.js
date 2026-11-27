/**
 * Память режима редактора: выбранный вопрос и прокрутка переживают переключение
 * «читатель ↔ редактор» и перезагрузку страницы.
 *
 * Ключ тот же, что использует читатель, когда запоминает текущий вопрос:
 * при входе в редактор открывается именно он (Правки: режим редактора, п. 3).
 */

export const testEditorStateKey = (blockId) => `course-builder:test-editor:${blockId}`;

/** Состояние редактора: { activeId?, scrollY? } (битые данные игнорируются). */
export function readEditorState(blockId) {
  try {
    const raw = globalThis.localStorage?.getItem(testEditorStateKey(blockId));
    if (!raw) return {};

    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return {};

    return {
      activeId: typeof state.activeId === 'string' ? state.activeId : null,
      scrollY: Number.isFinite(Number(state.scrollY)) ? Number(state.scrollY) : 0,
    };
  } catch {
    return {};
  }
}

/** Частичное обновление состояния: переданные поля заменяют прежние. */
export function writeEditorState(blockId, patch) {
  try {
    const next = { ...readEditorState(blockId), ...patch };
    globalThis.localStorage?.setItem(testEditorStateKey(blockId), JSON.stringify(next));
  } catch {
    // Переполнение хранилища не должно ломать редактор.
  }
}
