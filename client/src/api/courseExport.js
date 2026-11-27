import api, { getErrorMessage } from './axios.js';

/** Имя файла, если сервер не прислал Content-Disposition. */
export const FALLBACK_ARCHIVE_NAME = 'course.zip';

/**
 * Имя файла из Content-Disposition: сначала filename* (UTF-8, кириллица),
 * затем обычный filename; иначе — запасное имя.
 */
export function archiveFilename(header, fallback = FALLBACK_ARCHIVE_NAME) {
  const value = typeof header === 'string' ? header : '';

  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // битое процентное кодирование — пробуем обычный filename
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

/** Ошибка скачивания приходит Blob'ом: достаём message из JSON-тела. */
async function blobErrorMessage(error, fallback) {
  const data = error?.response?.data;

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.message) return String(parsed.message);
    } catch {
      // тело не JSON — покажем общее сообщение
    }
  }

  return getErrorMessage(error, fallback);
}

/** Сохраняет Blob как файл (браузерное скачивание без перезагрузки страницы). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Отзываем ссылку после того, как браузер начал скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * GET /api/courses/:id/export → скачивание ZIP-архива курса.
 * Возвращает { ok: true, filename } | { ok: false, message }.
 */
export async function downloadCourseArchive(course) {
  if (!course?.id) return { ok: false, message: 'Курс не выбран' };

  try {
    const response = await api.get(`/courses/${course.id}/export`, { responseType: 'blob' });
    const filename = archiveFilename(response.headers['content-disposition']);

    saveBlob(response.data, filename);
    return { ok: true, filename };
  } catch (error) {
    return { ok: false, message: await blobErrorMessage(error, 'Не удалось экспортировать курс') };
  }
}
