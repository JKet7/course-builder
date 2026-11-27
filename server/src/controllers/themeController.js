import prisma from '../config/prisma.js';
import {
  normalizeThemeColors,
  presentTheme,
  THEME_SELECT,
  THEME_LIMITS,
  themeNameField,
} from '../utils/theme.js';

const notFound = (res) => res.status(404).json({ message: 'Тема не найдена' });
const validationError = (res, errors) => res.status(400).json({ message: 'Ошибка валидации', errors });
const forbidden = (res, message) => res.status(403).json({ message });

/** Тема по умолчанию — самая старая глобальная. */
function findDefaultTheme() {
  return prisma.theme.findFirst({
    where: { isGlobal: true, ownerId: null },
    orderBy: { createdAt: 'asc' },
    select: THEME_SELECT,
  });
}

/**
 * GET /api/themes — глобальные темы и личные темы пользователя.
 * Администратор видит все темы (в том числе чужие личные).
 */
export async function listThemes(req, res) {
  const isAdmin = req.user.role === 'admin';

  const [themes, user] = await Promise.all([
    prisma.theme.findMany({
      where: isAdmin ? {} : { OR: [{ isGlobal: true, ownerId: null }, { ownerId: req.user.id }] },
      orderBy: [{ isGlobal: 'desc' }, { createdAt: 'asc' }],
      select: THEME_SELECT,
    }),
    prisma.user.findUnique({ where: { id: req.user.id }, select: { activeThemeId: true } }),
  ]);

  const globalCount = themes.filter((theme) => theme.isGlobal).length;
  const defaultTheme = themes.find((theme) => theme.isGlobal) ?? themes[0] ?? null;

  // Активная тема могла исчезнуть (удаление, смена прав) — тогда работает тема по умолчанию
  const activeThemeId = themes.some((theme) => theme.id === user?.activeThemeId)
    ? user.activeThemeId
    : (defaultTheme?.id ?? null);

  return res.json({
    themes: themes.map((theme) => presentTheme(theme, {
      userId: req.user.id,
      role: req.user.role,
      activeThemeId,
      globalCount,
    })),
    activeThemeId,
    defaultThemeId: defaultTheme?.id ?? null,
  });
}

/** POST /api/themes  body: { name, colors, isGlobal? } — личная тема; глобальную создаёт админ. */
export async function createTheme(req, res) {
  const name = themeNameField(req.body.name);
  if (!name) return validationError(res, { name: 'Название: обязательное поле' });

  const isGlobal = req.body.isGlobal === true;

  if (isGlobal && req.user.role !== 'admin') {
    return forbidden(res, 'Глобальные темы создаёт только администратор');
  }

  const normalized = normalizeThemeColors(req.body.colors);
  if (!normalized.ok) return validationError(res, { [normalized.field]: normalized.message });

  if (!isGlobal) {
    const own = await prisma.theme.count({ where: { ownerId: req.user.id, isGlobal: false } });
    if (own >= THEME_LIMITS.personal) {
      return validationError(res, { theme: `Не больше ${THEME_LIMITS.personal} личных тем на пользователя` });
    }
  }

  const theme = await prisma.theme.create({
    data: {
      name,
      colors: normalized.colors,
      isGlobal,
      ownerId: isGlobal ? null : req.user.id,
    },
    select: THEME_SELECT,
  });

  const [user, globalCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user.id }, select: { activeThemeId: true } }),
    prisma.theme.count({ where: { isGlobal: true } }),
  ]);

  res.locals.audit = { entityId: theme.id };

  return res.status(201).json({
    theme: presentTheme(theme, {
      userId: req.user.id,
      role: req.user.role,
      activeThemeId: user?.activeThemeId ?? null,
      globalCount,
    }),
  });
}

/** PUT /api/themes/:id  body: { name?, colors? } — владелец темы или администратор. */
export async function updateTheme(req, res) {
  const existing = await prisma.theme.findUnique({ where: { id: req.params.id }, select: THEME_SELECT });
  if (!existing) return notFound(res);

  const isOwn = existing.ownerId === req.user.id;
  if (!isOwn && req.user.role !== 'admin') {
    return forbidden(res, 'Можно изменять только свои темы');
  }

  const data = {};

  if (req.body.name !== undefined) {
    const name = themeNameField(req.body.name);
    if (!name) return validationError(res, { name: 'Название: обязательное поле' });
    data.name = name;
  }

  if (req.body.colors !== undefined) {
    const normalized = normalizeThemeColors(req.body.colors);
    if (!normalized.ok) return validationError(res, { [normalized.field]: normalized.message });
    data.colors = normalized.colors;
  }

  const [theme, user, globalCount] = await Promise.all([
    Object.keys(data).length > 0
      ? prisma.theme.update({ where: { id: existing.id }, data, select: THEME_SELECT })
      : Promise.resolve(existing),
    prisma.user.findUnique({ where: { id: req.user.id }, select: { activeThemeId: true } }),
    prisma.theme.count({ where: { isGlobal: true } }),
  ]);

  res.locals.audit = { entityId: theme.id };

  return res.json({
    theme: presentTheme(theme, {
      userId: req.user.id,
      role: req.user.role,
      activeThemeId: user?.activeThemeId ?? null,
      globalCount,
    }),
  });
}

/**
 * DELETE /api/themes/:id — личную тему удаляет владелец, глобальную — администратор.
 * Последнюю глобальную удалять нельзя: иначе нечего применять по умолчанию.
 * Ссылки User.activeThemeId обнуляются каскадом (onDelete: SetNull).
 */
export async function deleteTheme(req, res) {
  const theme = await prisma.theme.findUnique({ where: { id: req.params.id }, select: THEME_SELECT });
  if (!theme) return notFound(res);

  const isOwn = Boolean(theme.ownerId) && theme.ownerId === req.user.id;

  if (theme.isGlobal && req.user.role !== 'admin') {
    return forbidden(res, 'Глобальную тему удаляет только администратор');
  }

  if (!theme.isGlobal && !isOwn && req.user.role !== 'admin') {
    return forbidden(res, 'Можно удалять только свои темы');
  }

  if (theme.isGlobal) {
    const globalCount = await prisma.theme.count({ where: { isGlobal: true } });
    if (globalCount <= 1) {
      return validationError(res, { theme: 'Нельзя удалить последнюю глобальную тему' });
    }
  }

  await prisma.theme.delete({ where: { id: theme.id } });

  res.locals.audit = { entityId: theme.id };
  return res.json({ ok: true, id: theme.id });
}

/**
 * PUT /api/themes/active  body: { themeId } — выбрать тему пользователя.
 * themeId: null (или пустая строка) возвращает тему по умолчанию.
 */
export async function setActiveTheme(req, res) {
  const raw = req.body?.themeId;
  const themeId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;

  const requested = themeId
    ? await prisma.theme.findUnique({ where: { id: themeId }, select: THEME_SELECT })
    : null;

  if (themeId && !requested) return notFound(res);

  if (requested && !requested.isGlobal && requested.ownerId !== req.user.id && req.user.role !== 'admin') {
    return forbidden(res, 'Тема недоступна');
  }

  const target = requested ?? (await findDefaultTheme());

  if (!target) return notFound(res);

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { activeThemeId: target.id },
    select: { id: true, login: true, role: true, activeThemeId: true },
  });

  return res.json({
    user,
    themeId: target.id,
    theme: presentTheme(target, {
      userId: req.user.id,
      role: req.user.role,
      activeThemeId: target.id,
      globalCount: await prisma.theme.count({ where: { isGlobal: true } }),
    }),
  });
}
