import api, { getErrorMessage } from './axios.js';

/** Ограничения импорта (совпадает с server/src/utils/courseArchive.js). */
export const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;

/** Проверка архива до отправки: возвращает текст ошибки или null. */
export function validateArchiveFile(file) {
  if (!file) return 'Файл не выбран';
  if (!/\.zip$/i.test(file.name)) return 'Ожидается ZIP-архив (.zip)';
  if (file.size > MAX_ARCHIVE_SIZE) return 'Архив больше 50 МБ';
  return null;
}

/**
 * POST /api/courses/import (multipart, поле `file`).
 * Возвращает { ok: true, course, stats } | { ok: false, message }.
 */
export async function importCourseArchive(file) {
  const validationError = validateArchiveFile(file);
  if (validationError) return { ok: false, message: validationError };

  const form = new FormData();
  form.append('file', file);

  try {
    const { data } = await api.post('/courses/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return { ok: true, course: data.course, stats: data.stats };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, 'Не удалось импортировать курс') };
  }
}
