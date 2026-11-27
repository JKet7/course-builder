import 'dotenv/config';
import app from './app.js';
import prisma from './config/prisma.js';

const PORT = Number(process.env.PORT ?? 4000);

/** Попытки подключения к базе при старте: SQLite может быть занята миграцией. */
const DB_CONNECT_ATTEMPTS = Number(process.env.DB_CONNECT_ATTEMPTS ?? 10);
const DB_CONNECT_DELAY_MS = Number(process.env.DB_CONNECT_DELAY_MS ?? 500);

/** Сколько ждём завершения текущих запросов при остановке. */
const SHUTDOWN_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Прогрев соединения с базой.
 *
 * Prisma подключается лениво, поэтому сервер поднимался даже с нерабочей базой:
 * `/api/health` отвечал 200, а все запросы данных падали, и браузер показывал
 * 502/500. Теперь пробуем подключиться сразу и, если не вышло, всё равно
 * слушаем порт — API честно отвечает 503, пока база не поднимется.
 */
async function connectDatabase() {
  for (let attempt = 1; attempt <= DB_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$connect();
      console.log('[db] соединение установлено');
      return true;
    } catch (error) {
      const last = attempt === DB_CONNECT_ATTEMPTS;
      console.error(`[db] попытка ${attempt}/${DB_CONNECT_ATTEMPTS} не удалась: ${error.message}`);

      if (last) {
        console.error('[db] база недоступна: API будет отвечать 503. Проверьте server/.env и миграции (npm run prisma:migrate).');
        return false;
      }

      await sleep(DB_CONNECT_DELAY_MS * attempt);
    }
  }

  return false;
}

const server = app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  connectDatabase();
});

// Порт занят — почти всегда уже запущен второй экземпляр API.
// Без этого обработчика процесс падал с длинным стектрейсом.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[server] порт ${PORT} уже занят: остановите другой экземпляр API (Остановить сервер.bat).`);
  } else {
    console.error('[server] не удалось запуститься:', error);
  }
  process.exitCode = 1;
});

let shuttingDown = false;

/** Останавливаемся аккуратно: не принимаем новые запросы, текущие доигрываем. */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: завершаем работу`);

  // Страховка: если соединения не закрываются, выходим принудительно
  const force = setTimeout(() => {
    console.error('[server] не удалось закрыть соединения за отведённое время');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref?.();

  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Не оставляем процесс в неопределённом состоянии после сбоя
process.on('unhandledRejection', (reason) => {
  console.error('[server] необработанный reject:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[server] необработанное исключение:', error);
  shutdown('uncaughtException');
});

