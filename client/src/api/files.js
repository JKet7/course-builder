import api, { getErrorMessage } from './axios.js';

/**
 * Ограничения загрузки картинок (совпадает с server/src/utils/uploads.js).
 * SVG разрешён, но на сервере из него вырезаются скрипты (см. sanitizeSvg).
 */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

/** Ограничения загрузки видео (совпадает с server/src/utils/uploads.js). */
export const MAX_VIDEO_SIZE = 200 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

/** Проверка файла до отправки: возвращает текст ошибки или null. */
export function validateImageFile(file) {
  if (!file) return 'Файл не выбран';
  if (!IMAGE_MIME_TYPES.includes(file.type)) return 'Можно загружать только PNG, JPEG, WebP, GIF или SVG';
  if (file.size > MAX_IMAGE_SIZE) return 'Файл больше 5 МБ';
  return null;
}

/** Проверка видеофайла до отправки: возвращает текст ошибки или null. */
export function validateVideoFile(file) {
  if (!file) return 'Файл не выбран';
  if (!VIDEO_MIME_TYPES.includes(file.type)) return 'Можно загружать только MP4, WebM или OGG';
  if (file.size > MAX_VIDEO_SIZE) return `Файл больше ${MAX_VIDEO_SIZE / (1024 * 1024)} МБ`;
  return null;
}

/** POST /api/files общий для картинок и видео: FormData с полем `file`. */
async function uploadFile(file, fallbackMessage) {
  const form = new FormData();
  form.append('file', file);

  try {
    const { data } = await api.post('/files', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    return { ok: true, file: data.file };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, fallbackMessage) };
  }
}

/**
 * Загрузка картинки.
 * Возвращает { ok: true, file: { id, url, mimeType, size } } | { ok: false, message }.
 */
export async function uploadImage(file) {
  const validationError = validateImageFile(file);
  if (validationError) return { ok: false, message: validationError };

  return uploadFile(file, 'Не удалось загрузить картинку');
}

/**
 * Загрузка видеофайла (MP4/WebM/OGG, до 200 МБ).
 * Возвращает { ok: true, file: { id, url, mimeType, size } } | { ok: false, message }.
 */
export async function uploadVideo(file) {
  const validationError = validateVideoFile(file);
  if (validationError) return { ok: false, message: validationError };

  return uploadFile(file, 'Не удалось загрузить видео');
}

