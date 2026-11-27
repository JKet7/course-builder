/**
 * Смоук Шага 12: темы оформления (глобальные и личные), права и активная тема.
 * Запуск (из папки server): node scripts/smoke-step12.mjs
 * Требует `npm run db:seed` — в сиде есть глобальные темы «Классическая» и «Тёмная».
 */
import 'dotenv/config';
import fs from 'node:fs';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { signToken } from '../src/utils/jwt.js';
import { DEFAULT_THEME_COLORS } from '../src/utils/theme.js';

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const checks = [];
const check = (name, ok, details) => checks.push({ name, ok: Boolean(ok), details });
// Аудит пишется в res.on('finish') асинхронно — даём записи дойти до БД
const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = new Date();
const TEST_PREFIX = 'Шаг 12:';

// ===== чистая песочница =====
await prisma.theme.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step12-' } } });

const reader = await prisma.user.create({
  data: { login: 'step12-reader', passwordHash: 'not-used', role: 'reader' },
});
const editor = await prisma.user.create({
  data: { login: 'step12-editor', passwordHash: 'not-used', role: 'editor' },
});
const readerToken = signToken(reader);
const editorToken = signToken(editor);

const admin = await req('/api/auth/login', { method: 'POST', body: { login: 'admin', password: 'admin123' } });
const token = admin.body?.token;
check('login admin', admin.status === 200 && Boolean(token), admin.status);

check('GET /themes без токена -> 401', (await req('/api/themes')).status === 401);

// ===== список тем =====
const adminList = await req('/api/themes', { token });
const adminThemes = adminList.body?.themes ?? [];
const globalsInList = adminThemes.filter((theme) => theme.isGlobal);

check('GET /themes (admin) -> 200 и список', adminList.status === 200 && adminThemes.length > 0, adminList.status);
check('в сиде есть глобальные темы', globalsInList.length >= 2, globalsInList.map((theme) => theme.name).join(', '));
check(
  'у каждой темы есть роли цветов и палитра',
  adminThemes.every((theme) => theme.colors?.accent && theme.colors?.themeColors?.length === 10),
);
check('activeThemeId существует в списке', adminThemes.some((theme) => theme.id === adminList.body?.activeThemeId));
check('defaultThemeId — глобальная тема', globalsInList.some((theme) => theme.id === adminList.body?.defaultThemeId));
check('админ может править глобальную тему', globalsInList.every((theme) => theme.canEdit === true));
const firstPersonalIndex = adminThemes.findIndex((theme) => !theme.isGlobal);
const lastGlobalIndex = adminThemes.map((theme) => theme.isGlobal).lastIndexOf(true);
check(
  'сортировка: глобальные раньше личных',
  firstPersonalIndex === -1 || firstPersonalIndex > lastGlobalIndex,
  `${firstPersonalIndex} / ${lastGlobalIndex}`,
);

const readerList = await req('/api/themes', { token: readerToken });
const readerThemes = readerList.body?.themes ?? [];
check('GET /themes (reader) -> 200', readerList.status === 200);
check(
  'reader видит только глобальные темы',
  readerThemes.length === globalsInList.length && readerThemes.every((theme) => theme.isGlobal),
  readerThemes.length,
);
check('reader не может править темы', readerThemes.every((theme) => theme.canEdit === false));
check('reader не может удалять темы', readerThemes.every((theme) => theme.canDelete === false));

// ===== создание личной темы =====
const readerTheme = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} личная reader`, colors: DEFAULT_THEME_COLORS },
});
const readerThemeId = readerTheme.body?.theme?.id;

check(
  'POST /themes (reader) -> 201, личная тема',
  readerTheme.status === 201 && readerTheme.body?.theme?.isGlobal === false,
  readerTheme,
);
check('владелец темы — reader', readerTheme.body?.theme?.ownerId === reader.id);
check('создатель может править и удалять свою тему', readerTheme.body?.theme?.canEdit === true && readerTheme.body?.theme?.canDelete === true);

const shortHex = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} короткий HEX`, colors: { ...DEFAULT_THEME_COLORS, accent: '#abc' } },
});
check('короткий HEX нормализуется в #AABBCC', shortHex.body?.theme?.colors?.accent === '#AABBCC', shortHex.body?.theme?.colors?.accent);

const noName = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: '   ', colors: DEFAULT_THEME_COLORS },
});
check('POST /themes без названия -> 400 errors.name', noName.status === 400 && Boolean(noName.body?.errors?.name), noName);

const badColor = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} битый цвет`, colors: { ...DEFAULT_THEME_COLORS, text: 'синенький' } },
});
check('POST /themes с битым цветом -> 400 errors.colors', badColor.status === 400 && Boolean(badColor.body?.errors?.colors), badColor);

const shortPalette = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} короткая палитра`, colors: { ...DEFAULT_THEME_COLORS, themeColors: ['#FFFFFF'] } },
});
check('POST /themes с палитрой не из 10 -> 400', shortPalette.status === 400 && Boolean(shortPalette.body?.errors?.colors));

const readerGlobal = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} глобальная от reader`, colors: DEFAULT_THEME_COLORS, isGlobal: true },
});
check('POST /themes isGlobal от reader -> 403', readerGlobal.status === 403, readerGlobal.status);

// ===== права на чужие темы =====
const editorTheme = await req('/api/themes', {
  method: 'POST',
  token: editorToken,
  body: { name: `${TEST_PREFIX} личная editor`, colors: DEFAULT_THEME_COLORS },
});
const editorThemeId = editorTheme.body?.theme?.id;

check('POST /themes (editor) -> 201', editorTheme.status === 201 && Boolean(editorThemeId));

const readerListAfter = await req('/api/themes', { token: readerToken });
const readerThemesAfter = readerListAfter.body?.themes ?? [];
check(
  'reader видит свою личную тему',
  readerThemesAfter.some((theme) => theme.id === readerThemeId && theme.isOwn === true),
);
check(
  'reader не видит личную тему editor',
  readerThemesAfter.every((theme) => theme.id !== editorThemeId),
);

const renameOwn = await req(`/api/themes/${readerThemeId}`, {
  method: 'PUT',
  token: readerToken,
  body: { name: `${TEST_PREFIX} переименована` },
});
check('PUT своей темы -> 200 и новое название', renameOwn.status === 200 && renameOwn.body?.theme?.name === `${TEST_PREFIX} переименована`);

const renameForeign = await req(`/api/themes/${editorThemeId}`, {
  method: 'PUT',
  token: readerToken,
  body: { name: 'взлом' },
});
check('PUT чужой личной темы -> 403', renameForeign.status === 403, renameForeign.status);

const globalTheme = globalsInList[0];
const renameGlobalByReader = await req(`/api/themes/${globalTheme.id}`, {
  method: 'PUT',
  token: readerToken,
  body: { name: 'взлом глобальной' },
});
check('PUT глобальной темы reader-ом -> 403', renameGlobalByReader.status === 403, renameGlobalByReader.status);

const renameMissing = await req('/api/themes/no-such-theme', {
  method: 'PUT',
  token: readerToken,
  body: { name: 'нет такой' },
});
check('PUT несуществующей темы -> 404', renameMissing.status === 404, renameMissing.status);

// ===== глобальные темы админа =====
const adminGlobal = await req('/api/themes', {
  method: 'POST',
  token,
  body: { name: `${TEST_PREFIX} глобальная`, colors: DEFAULT_THEME_COLORS, isGlobal: true },
});
const adminGlobalId = adminGlobal.body?.theme?.id;

check(
  'POST глобальной темы (admin) -> 201',
  adminGlobal.status === 201 && adminGlobal.body?.theme?.isGlobal === true && adminGlobal.body?.theme?.ownerId === null,
  adminGlobal.status,
);
check('админ может удалить глобальную тему', adminGlobal.body?.theme?.canDelete === true);

const editGlobal = await req(`/api/themes/${adminGlobalId}`, {
  method: 'PUT',
  token,
  body: { colors: { ...DEFAULT_THEME_COLORS, accent: '#123456' } },
});
check(
  'PUT глобальной темы (admin) -> 200 и новый акцент',
  editGlobal.status === 200 && editGlobal.body?.theme?.colors?.accent === '#123456',
  editGlobal.body?.theme?.colors?.accent,
);

// ===== активная тема =====
await pause();

const auditBefore = await prisma.auditLog.count({
  where: { entity: 'Theme', createdAt: { gte: startedAt } },
});

const setActiveOwn = await req('/api/themes/active', {
  method: 'PUT',
  token: readerToken,
  body: { themeId: readerThemeId },
});
check('PUT /themes/active на свою тему -> 200', setActiveOwn.status === 200 && setActiveOwn.body?.themeId === readerThemeId, setActiveOwn);

await pause();

const readerAfterActive = await req('/api/themes', { token: readerToken });
check(
  'выбранная тема помечена isActive',
  readerAfterActive.body?.themes?.find((theme) => theme.id === readerThemeId)?.isActive === true,
);

const readerRow = await prisma.user.findUnique({ where: { id: reader.id }, select: { activeThemeId: true } });
check('activeThemeId сохранён в БД', readerRow?.activeThemeId === readerThemeId);

const auditAfter = await prisma.auditLog.count({
  where: { entity: 'Theme', createdAt: { gte: startedAt } },
});
check('выбор темы не пишет аудит', auditBefore === auditAfter, `${auditBefore} -> ${auditAfter}`);

const setActiveForeign = await req('/api/themes/active', {
  method: 'PUT',
  token: readerToken,
  body: { themeId: editorThemeId },
});
check('PUT /themes/active на чужую личную тему -> 403', setActiveForeign.status === 403, setActiveForeign.status);

const setActiveMissing = await req('/api/themes/active', {
  method: 'PUT',
  token: readerToken,
  body: { themeId: 'no-such-theme' },
});
check('PUT /themes/active с несуществующей темой -> 404', setActiveMissing.status === 404, setActiveMissing.status);

const resetActive = await req('/api/themes/active', {
  method: 'PUT',
  token: readerToken,
  body: { themeId: null },
});
check(
  'themeId: null возвращает тему по умолчанию',
  resetActive.status === 200 && resetActive.body?.themeId === readerAfterActive.body?.defaultThemeId,
  resetActive.body?.themeId,
);

// ===== удаление =====
const deleteOwn = await req(`/api/themes/${readerThemeId}`, { method: 'DELETE', token: readerToken });
check('DELETE своей темы -> 200', deleteOwn.status === 200, deleteOwn.status);
check('тема удалена из БД', (await prisma.theme.count({ where: { id: readerThemeId } })) === 0);

const deleteForeign = await req(`/api/themes/${editorThemeId}`, { method: 'DELETE', token: readerToken });
check('DELETE чужой личной темы -> 403', deleteForeign.status === 403, deleteForeign.status);

const deleteGlobalByReader = await req(`/api/themes/${globalTheme.id}`, { method: 'DELETE', token: readerToken });
check('DELETE глобальной темы reader-ом -> 403', deleteGlobalByReader.status === 403, deleteGlobalByReader.status);

const deleteMissing = await req('/api/themes/no-such-theme', { method: 'DELETE', token: readerToken });
check('DELETE несуществующей темы -> 404', deleteMissing.status === 404, deleteMissing.status);

// ===== удаление активной темы =====
const tempTheme = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} временная`, colors: DEFAULT_THEME_COLORS },
});
const tempThemeId = tempTheme.body?.theme?.id;

await req('/api/themes/active', { method: 'PUT', token: readerToken, body: { themeId: tempThemeId } });
const deleteActive = await req(`/api/themes/${tempThemeId}`, { method: 'DELETE', token: readerToken });

const readerAfterDelete = await prisma.user.findUnique({
  where: { id: reader.id },
  select: { activeThemeId: true },
});
check(
  'удаление активной темы обнуляет activeThemeId',
  deleteActive.status === 200 && readerAfterDelete?.activeThemeId === null,
  readerAfterDelete?.activeThemeId,
);

const readerListAfterDelete = await req('/api/themes', { token: readerToken });
check(
  'GET /themes подставляет тему по умолчанию',
  readerListAfterDelete.body?.activeThemeId === readerListAfterDelete.body?.defaultThemeId,
);

// ===== последнюю глобальную удалять нельзя =====
const deleteAdminGlobal = await req(`/api/themes/${adminGlobalId}`, { method: 'DELETE', token });
check('DELETE глобальной темы (admin) -> 200', deleteAdminGlobal.status === 200, deleteAdminGlobal.status);

const globalsNow = await prisma.theme.findMany({ where: { isGlobal: true }, orderBy: { createdAt: 'asc' } });
const extras = globalsNow.slice(1).map((theme) => theme.id);

try {
  await prisma.theme.updateMany({ where: { id: { in: extras } }, data: { isGlobal: false } });
  const lastGlobalDelete = await req(`/api/themes/${globalsNow[0].id}`, { method: 'DELETE', token });

  check(
    'последнюю глобальную тему удалить нельзя -> 400',
    lastGlobalDelete.status === 400 && Boolean(lastGlobalDelete.body?.errors?.theme),
    lastGlobalDelete.body,
  );
  check(
    'последняя глобальная тема осталась в БД',
    (await prisma.theme.count({ where: { id: globalsNow[0].id } })) === 1,
  );
} finally {
  await prisma.theme.updateMany({ where: { id: { in: extras } }, data: { isGlobal: true } });
}

check(
  'глобальные темы восстановлены',
  (await prisma.theme.count({ where: { isGlobal: true } })) === globalsNow.length,
);

// ===== лимит личных тем =====
let ownCount = await prisma.theme.count({ where: { ownerId: reader.id, isGlobal: false } });

while (ownCount < 20) {
  await req('/api/themes', {
    method: 'POST',
    token: readerToken,
    body: { name: `${TEST_PREFIX} лимит ${ownCount}`, colors: DEFAULT_THEME_COLORS },
  });
  ownCount += 1;
}

const overLimit = await req('/api/themes', {
  method: 'POST',
  token: readerToken,
  body: { name: `${TEST_PREFIX} сверх лимита`, colors: DEFAULT_THEME_COLORS },
});
check('21-я личная тема -> 400', overLimit.status === 400, overLimit.status);

// ===== аудит =====
await pause();

const themeAudit = await prisma.auditLog.findMany({
  where: { entity: 'Theme', createdAt: { gte: startedAt } },
  select: { action: true, entityId: true, userId: true },
});
check(
  'аудит: create/update/delete по темам',
  ['create', 'update', 'delete'].every((action) => themeAudit.some((row) => row.action === action)),
  themeAudit.length,
);
check('аудит: userId проставлен', themeAudit.length > 0 && themeAudit.every((row) => Boolean(row.userId)));

// ===== очистка =====
await prisma.auditLog.deleteMany({ where: { entity: 'Theme', createdAt: { gte: startedAt } } });
await prisma.theme.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
await prisma.user.deleteMany({ where: { login: { startsWith: 'step12-' } } });

const out = {
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
fs.writeFileSync('step12-result.json', JSON.stringify(out, null, 2), 'utf8');

console.log(`smoke-step12: ${out.passed}/${checks.length} passed`);
for (const item of checks.filter((entry) => !entry.ok)) {
  console.log(`FAIL  ${item.name} — ${JSON.stringify(item.details)}`);
}

server.close();
await prisma.$disconnect();
process.exitCode = out.failed ? 1 : 0;
