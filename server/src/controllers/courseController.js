import prisma from '../config/prisma.js';
import { getNextOrder, reorderItems, validateOrder } from '../utils/order.js';
import { COURSE_LINK_SELECT, toLinkMap } from '../utils/linkMap.js';

const COURSE_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { blocks: true } },
};

const BLOCK_PREVIEW_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  coverImage: true,
  order: true,
  updatedAt: true,
};

const toCourse = (course) => {
  const { _count, ...rest } = course;
  return { ...rest, blocksCount: _count?.blocks ?? 0 };
};

const notFound = (res, message = 'Курс не найден') => res.status(404).json({ message });

/** GET /api/courses?search= */
export async function listCourses(req, res) {
  const search = String(req.query.search ?? '').trim();

  const courses = await prisma.course.findMany({
    where: search
      ? { OR: [{ title: { contains: search } }, { description: { contains: search } }] }
      : undefined,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: COURSE_LIST_SELECT,
  });

  return res.json({ courses: courses.map(toCourse) });
}

/** GET /api/courses/:id */
export async function getCourse(req, res) {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: {
      ...COURSE_LIST_SELECT,
      blocks: { orderBy: { order: 'asc' }, select: BLOCK_PREVIEW_SELECT },
    },
  });

  if (!course) return notFound(res);

  return res.json({ course: toCourse(course) });
}

/**
 * GET /api/courses/:id/links — карта курса для внутренних ссылок (Правка 6).
 * Только подписи и id: блоки, слайды, вопросы, ячейки памятки и термины.
 * Доступна любому авторизованному пользователю, ответ не кешируется.
 */
export async function getCourseLinks(req, res) {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: COURSE_LINK_SELECT,
  });

  if (!course) return notFound(res);

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ course: toLinkMap(course) });
}

/** POST /api/courses */
export async function createCourse(req, res) {
  const { title, description } = req.body;
  const order = await getNextOrder(prisma.course);

  const course = await prisma.course.create({
    data: { title, description: description ?? null, order },
    select: COURSE_LIST_SELECT,
  });

  res.locals.audit = { entityId: course.id };
  return res.status(201).json({ course: toCourse(course) });
}

/** PUT /api/courses/:id */
export async function updateCourse(req, res) {
  const data = {};

  if (typeof req.body.title === 'string') data.title = req.body.title;

  if (req.body.description !== undefined) {
    const value = typeof req.body.description === 'string' ? req.body.description.trim() : req.body.description;
    data.description = value === '' || value === null ? null : value;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Нет полей для обновления' });
  }

  try {
    const course = await prisma.course.update({
      where: { id: req.params.id },
      data,
      select: COURSE_LIST_SELECT,
    });

    res.locals.audit = { entityId: course.id };
    return res.json({ course: toCourse(course) });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }
}

/** DELETE /api/courses/:id */
export async function deleteCourse(req, res) {
  try {
    await prisma.course.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error.code === 'P2025') return notFound(res);
    throw error;
  }

  res.locals.audit = { entityId: req.params.id };
  return res.json({ ok: true, id: req.params.id });
}

/** PUT /api/courses/reorder  body: { orderedIds: string[] } */
export async function reorderCourses(req, res) {
  const { orderedIds } = req.body;

  const existing = await prisma.course.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((course) => course.id));
  const unknownIds = orderedIds.filter((id) => !existingIds.has(id));

  if (unknownIds.length > 0) {
    return res.status(400).json({ message: 'Неизвестные id курсов', unknownIds });
  }

  const orderError = validateOrder(orderedIds, existingIds, 'курсов');
  if (orderError) return res.status(400).json(orderError);

  await reorderItems(prisma.course, orderedIds);

  const courses = await prisma.course.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: COURSE_LIST_SELECT,
  });

  res.locals.audit = { entityId: null };
  return res.json({ courses: courses.map(toCourse) });
}
