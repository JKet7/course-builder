import prisma from '../config/prisma.js';
import { HELP_COURSE_SELECT, buildBlockHelp } from '../utils/help.js';

/**
 * GET /api/blocks/:id/help — справка о блоке (Правка 7).
 *
 * Один запрос на курс: примечания открытого блока с номерами и местами
 * плюс обратные ссылки (где блок упоминается). Карта ссылок для этого
 * не подходит — в ней только подписи целей, без текста примечаний.
 */
export async function getBlockHelp(req, res) {
  const block = await prisma.block.findUnique({
    where: { id: req.params.id },
    select: { id: true, courseId: true },
  });

  if (!block) return res.status(404).json({ message: 'Блок не найден' });

  const course = await prisma.course.findUnique({
    where: { id: block.courseId },
    select: HELP_COURSE_SELECT,
  });

  const full = (course?.blocks ?? []).find((item) => item.id === block.id);
  if (!full) return res.status(404).json({ message: 'Блок не найден' });

  return res.json({ help: buildBlockHelp(full, course) });
}
