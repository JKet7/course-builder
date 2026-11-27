import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * Путь к файлу SQLite вычисляем сами.
 *
 * В `.env` записано `DATABASE_URL="file:./dev.db"`, а относительный путь Prisma
 * раскрывает от каталога schema.prisma. У сгенерированного клиента схема — это
 * копия в node_modules/.prisma/client (`config.dirname = __dirname`), поэтому
 * сервер открывал ПУСТУЮ базу node_modules/.prisma/client/dev.db и отвечал 500
 * «The table `main.User` does not exist» на /api/auth/login, /api/courses,
 * /api/themes. Настоящая база лежит рядом со схемой — server/prisma/dev.db,
 * там же её создают `prisma migrate` и `prisma db seed`.
 *
 * Поэтому путь считаем от самого модуля: результат не зависит от текущего
 * каталога процесса, имени папки проекта и того, где оказался клиент.
 */
const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');

/**
 * `file:./dev.db` → `file:C:/.../server/prisma/dev.db`.
 * Остальные URL (postgres://, file:///abs/path, абсолютный file:C:/...) — как есть.
 */
export function resolveDatabaseUrl(url = process.env.DATABASE_URL ?? '') {
  if (!/^file:(?!\/\/)/i.test(url)) return url;

  const filePath = url.slice('file:'.length);
  if (!filePath || path.isAbsolute(filePath) || /^[a-z]:/i.test(filePath)) return url;

  return `file:${path.resolve(SCHEMA_DIR, filePath).replace(/\\/g, '/')}`;
}

const databaseUrl = resolveDatabaseUrl();

export const prisma = new PrismaClient(databaseUrl ? { datasourceUrl: databaseUrl } : {});

export default prisma;
