import api, { getErrorMessage } from './axios.js';
import { saveBlob } from './courseExport.js';

/** Ограничение размера файла блока (совпадает с blockTransferController.js). */
export const BLOCK_FILE_MAX_SIZE = 10 * 1024 * 1024;

/** Проверка файла блока до отправки: возвращает текст ошибки или null. */
export function validateBlockFile(file) {
  if (!file) return 'Файл не выбран';
  if (!/\.(json|zip)$/i.test(file.name)) return 'Ожидается файл блока (.json) или ZIP-архив (.zip)';
  if (file.size > BLOCK_FILE_MAX_SIZE) return 'Файл больше 10 МБ';
  return null;
}

/** Читаемое имя файла блока: без запрещённых в файловой системе символов. */
export function blockFileName(title) {
  const clean = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${clean || 'block'}.json`;
}

/**
 * GET /api/blocks/:id/export → скачивание JSON-манифеста блока.
 * Возвращает { ok: true, filename } | { ok: false, message }.
 */
export async function downloadBlockFile(block) {
  if (!block?.id) return { ok: false, message: 'Блок не выбран' };

  try {
    const { data } = await api.get(`/blocks/${block.id}/export`);
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });

    saveBlob(blob, blockFileName(block.title));
    return { ok: true, filename: blockFileName(block.title) };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, 'Не удалось скачать блок') };
  }
}

/**
 * POST /api/blocks/import (multipart, поля `file` и `courseId`).
 * Возвращает { ok: true, block } | { ok: false, message }.
 */
export async function importBlockFile(courseId, file) {
  const validationError = validateBlockFile(file);
  if (validationError) return { ok: false, message: validationError };

  const form = new FormData();
  form.append('file', file);
  form.append('courseId', courseId);

  try {
    const { data } = await api.post('/blocks/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return { ok: true, block: data.block };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, 'Не удалось загрузить блок') };
  }
}
