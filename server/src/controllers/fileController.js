import path from 'node:path';
import multer from 'multer';
import prisma from '../config/prisma.js';
import {
  IMAGE_MIME_EXT,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MIME_EXT,
  SVG_MIME_TYPE,
  UPLOADS_DIR,
  ensureUploadsDir,
  publicFileUrl,
  removeUploadedFile,
  sanitizeSvgFile,
  uniqueUploadFilename,
} from '../utils/uploads.js';

const MB = 1024 * 1024;

/** Ошибка проверки файла (не картинка и не видео), чтобы вернуть 400, а не 500. */
class UploadError extends Error {}

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (req, file, onDone) => onDone(null, ensureUploadsDir()),
  filename: (req, file, onDone) => {
    onDone(null, uniqueUploadFilename(MIME_EXT[file.mimetype] ?? ''));
  },
});

const upload = multer({
  storage,
  // Общий лимит — размер видео; картинки дополнительно проверяются в createFile.
  limits: { fileSize: MAX_VIDEO_SIZE, files: 1 },
  fileFilter: (req, file, onDone) => {
    if (!MIME_EXT[file.mimetype]) {
      return onDone(
        new UploadError(
          'Можно загружать только изображения (PNG, JPEG, WebP, GIF, SVG) и видео (MP4, WebM, OGG)',
        ),
      );
    }
    return onDone(null, true);
  },
});

/** Приём одного файла (поле `file`: картинка или видео) с понятными ошибками валидации. */
export function uploadOneFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof UploadError) {
      return res.status(400).json({ message: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: `Файл больше ${MAX_VIDEO_SIZE / MB} МБ` });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: `Ошибка загрузки: ${error.message}` });
    }
    return next(error);
  });
}

/** POST /api/files — сохраняет картинку или видео и запись File, отдаёт { file: { id, url, ... } } */
export async function createFile(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Файл не передан (ожидается поле file)' });
  }

  const filename = path.basename(req.file.filename);

  // Лимит мультера общий (как у видео), поэтому картинку проверяем отдельно.
  if (IMAGE_MIME_EXT[req.file.mimetype] && req.file.size > MAX_IMAGE_SIZE) {
    removeUploadedFile(filename);
    return res.status(400).json({ message: `Файл больше ${MAX_IMAGE_SIZE / MB} МБ` });
  }

  // SVG может содержать скрипты: чистим файл до записи в БД.
  if (req.file.mimetype === SVG_MIME_TYPE) {
    sanitizeSvgFile(path.join(UPLOADS_DIR, filename));
  }

  const file = await prisma.file.create({
    data: {
      path: publicFileUrl(filename),
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user?.id ?? null,
    },
    select: { id: true, path: true, mimeType: true, size: true, createdAt: true },
  });

  res.locals.audit = { entityId: file.id };
  return res.status(201).json({
    file: { id: file.id, url: file.path, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt },
  });
}

/** DELETE /api/files/:id — удаляет запись и файл с диска */
export async function deleteFile(req, res) {
  const file = await prisma.file.findUnique({ where: { id: req.params.id }, select: { id: true, path: true } });
  if (!file) return res.status(404).json({ message: 'Файл не найден' });

  await prisma.file.delete({ where: { id: file.id } });
  removeUploadedFile(path.basename(file.path));

  res.locals.audit = { entityId: file.id };
  return res.json({ ok: true, id: file.id });
}
