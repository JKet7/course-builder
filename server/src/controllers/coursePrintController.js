/**
 * Печатная версия курса (Шаг 15).
 *
 * GET /api/courses/:id/print отдаёт курс целиком — блоки со слайдами, контентом,
 * вопросами, памяткой и глоссарием — одним JSON. Страница `/course/:id/print`
 * строит из него документ и сохраняет его в PDF средствами браузера
 * (window.print → «Сохранить как PDF»), поэтому сервер не зависит от
 * PDF-библиотек и шрифтов.
 *
 * Доступ: любой авторизованный пользователь — читатель тоже может распечатать
 * курс. Ответы помечены `isCorrect`, страница показывает их по переключателю.
 * Ответы: 200 — данные; 401 — нет токена; 404 — курса нет. GET не аудируется.
 */
import prisma from '../config/prisma.js';
import { COURSE_PRINT_SELECT, toPrintCourse } from '../utils/coursePrint.js';

/** GET /api/courses/:id/print — данные для печати курса */
export async function getCoursePrint(req, res) {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: COURSE_PRINT_SELECT,
  });

  if (!course) return res.status(404).json({ message: 'Курс не найден' });

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ course: toPrintCourse(course), generatedAt: new Date().toISOString() });
}
