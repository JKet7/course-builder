import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Папка загруженных файлов: server/uploads (в .gitignore). */
export const UPLOADS_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));

/** Разрешённые типы картинок и расширения, с которыми сохраняем файл на диск. */
export const IMAGE_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

/** SVG-файл — единственный формат, который может содержать скрипты. */
export const SVG_MIME_TYPE = 'image/svg+xml';

/** Максимальный размер картинки — 5 МБ. */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Разрешённые типы видео и расширения, с которыми сохраняем файл на диске. */
export const VIDEO_MIME_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
};

/** Максимальный размер видео — 200 МБ. */
export const MAX_VIDEO_SIZE = 200 * 1024 * 1024;

/** Все разрешённые загрузки: MIME → расширение файла на диске. */
export const MIME_EXT = { ...IMAGE_MIME_EXT, ...VIDEO_MIME_EXT };

/** Публичный адрес файла по имени на диске. */
export const publicFileUrl = (filename) => `/uploads/${filename}`;

/**
 * Уникальное имя файла на диске: время в base36 + случайный хвост.
 * Используется и загрузкой картинок, и импортом архива (Шаг 13).
 */
export const uniqueUploadFilename = (ext = '') =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${ext}`;

/** Создаёт папку загрузок, если её ещё нет. */
export function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

/** Удаляет файл с диска; отсутствие файла не считается ошибкой. */
export function removeUploadedFile(filename) {
  if (!filename) return;

  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, filename));
  } catch {
    // файла уже нет — запись в БД всё равно удаляем
  }
}

/**
 * Чистка загруженного SVG: вырезает скрипты, обработчики событий и
 * javascript:-ссылки. Файл отдаётся с того же домена, поэтому без чистки
 * SVG стал бы способом выполнить чужой код (а ещё его можно вставить
 * картинкой — тогда скрипты не нужны вовсе).
 * Возвращает true, если файл пришлось изменить.
 */
export function sanitizeSvgFile(filePath) {
  let source;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }

  const clean = source
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<(foreignObject|iframe|embed|object|audio|video)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');

  if (clean === source) return false;

  try {
    fs.writeFileSync(filePath, clean, 'utf8');
  } catch {
    return false;
  }

  return true;
}
