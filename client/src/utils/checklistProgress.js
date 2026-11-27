/**
 * Прогресс чек-листов читателя (Правка 10).
 *
 * Отметки хранятся в localStorage отдельно для каждого блока:
 *   course-builder:checklist:<blockId> → { "<contentId>:<itemId>": true }
 *
 * В файл попадают только отмеченные пункты: снятая галочка удаляет ключ,
 * поэтому пустой прогресс не занимает место и легко сбрасывается.
 * Все операции терпимы к недоступному localStorage (приватный режим,
 * SSR) — тогда чек-лист работает как обычный просмотр.
 */

const STORAGE_PREFIX = 'course-builder:checklist:';

/** Ключ localStorage для прогресса блока. */
export function checklistStorageKey(blockId) {
  return `${STORAGE_PREFIX}${String(blockId ?? '').trim()}`;
}

/** Ключ пункта внутри блока: фрагмент + пункт. */
export function checklistItemKey(contentId, itemId) {
  return `${String(contentId ?? '')}:${String(itemId ?? '')}`;
}

function getStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Читает отметки блока; повреждённые данные считаются пустым прогрессом. */
export function readChecklistProgress(blockId) {
  const id = String(blockId ?? '').trim();
  if (!id) return {};

  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(checklistStorageKey(id));
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true));
  } catch {
    return {};
  }
}

/** Сохраняет только отмеченные пункты; пустой прогресс удаляет ключ блока. */
export function writeChecklistProgress(blockId, progress) {
  const id = String(blockId ?? '').trim();
  const clean = Object.fromEntries(
    Object.entries(progress && typeof progress === 'object' ? progress : {}).filter(
      ([, value]) => value === true,
    ),
  );

  if (!id) return clean;

  const storage = getStorage();
  if (!storage) return clean;

  try {
    if (Object.keys(clean).length === 0) storage.removeItem(checklistStorageKey(id));
    else storage.setItem(checklistStorageKey(id), JSON.stringify(clean));
  } catch {
    // Переполненное или запрещённое хранилище не должно ломать чтение
  }

  return clean;
}

/** Отмечен ли пункт фрагмента. */
export function isChecklistItemChecked(progress, contentId, itemId) {
  return progress?.[checklistItemKey(contentId, itemId)] === true;
}

/**
 * Ставит/снимает отметку пункта и сразу сохраняет прогресс.
 * Возвращает новую карту отметок для setState.
 */
export function setChecklistItemChecked(blockId, contentId, itemId, checked) {
  const progress = readChecklistProgress(blockId);
  const key = checklistItemKey(contentId, itemId);

  if (checked) progress[key] = true;
  else delete progress[key];

  return writeChecklistProgress(blockId, progress);
}

/** Есть ли в блоке хотя бы одна сохранённая отметка. */
export function hasChecklistProgress(blockId) {
  return Object.keys(readChecklistProgress(blockId)).length > 0;
}

/** Сбрасывает все отметки блока — кнопка «Сначала» в списке блоков курса. */
export function resetChecklistProgress(blockId) {
  const id = String(blockId ?? '').trim();
  if (!id) return;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(checklistStorageKey(id));
  } catch {
    // Если хранилище недоступно, сбрасывать нечего
  }
}
