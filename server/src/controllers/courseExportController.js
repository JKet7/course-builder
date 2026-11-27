/**
 * Экспорт курса в ZIP-архив (Шаг 14).
 *
 * GET /api/courses/:id/export отдаёт готовый архив (application/zip) с тем же
 * `course.json`, который понимает импорт Шага 13. Собирает архив чистая функция
 * `buildCourseArchive` (utils/courseExport.js) — БД только читается.
 *
 * Ответы: 200 — ZIP; 404 — курса нет; 409 — данные курса не позволяют собрать
 * корректный архив (файл из БД отсутствует на диске, превышены лимиты импорта).
 */
import prisma from '../config/prisma.js';
import { COURSE_EXPORT_SELECT, buildCourseArchive, collectFileRefs } from '../utils/courseExport.js';

/** Значения, которые encodeURIComponent не кодирует, а RFC 5987 требует. */
const RFC5987_EXTRA = { "'": '%27', '*': '%2A' };

/** Content-Disposition с ASCII-именем и UTF-8 именем (кириллица в названии курса). */
function contentDisposition(asciiName, unicodeName) {
  const encoded = encodeURIComponent(unicodeName).replace(/['*]/g, (char) => RFC5987_EXTRA[char]);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/** GET /api/courses/:id/export — ZIP-архив курса */
export async function exportCourse(req, res) {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: COURSE_EXPORT_SELECT,
  });

  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  // Записи File нужны только по ссылкам из контента и обложек блоков.
  const { ids, paths } = collectFileRefs(course);
  const conditions = [];

  if (ids.size > 0) conditions.push({ id: { in: [...ids] } });
  if (paths.size > 0) conditions.push({ path: { in: [...paths] } });

  const files = conditions.length > 0 ? await prisma.file.findMany({ where: { OR: conditions } }) : [];
  const result = buildCourseArchive(course, files);

  if (!result.ok) return res.status(result.status ?? 409).json({ message: result.message });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition(result.filename, result.downloadName));
  res.setHeader('Content-Length', result.buffer.length);
  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).send(result.buffer);
}
