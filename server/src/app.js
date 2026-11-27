import express from 'express';
import cors from 'cors';
import prisma from './config/prisma.js';
import { requestTimeout } from './middleware/timeout.js';
import authRoutes from './routes/authRoutes.js';
import blockRoutes from './routes/blockRoutes.js';
import contentRoutes from './routes/contentRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import glossaryRoutes from './routes/glossaryRoutes.js';
import memoRoutes from './routes/memoRoutes.js';
import memoSlideRoutes from './routes/memoSlideRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import slideRoutes from './routes/slideRoutes.js';
import testGroupRoutes from './routes/testGroupRoutes.js';
import testSectionRoutes from './routes/testSectionRoutes.js';
import testSettingsRoutes from './routes/testSettingsRoutes.js';
import themeRoutes from './routes/themeRoutes.js';
import { UPLOADS_DIR } from './utils/uploads.js';

const app = express();

const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Зависшее чтение превращается в понятный 503, а не в 502 от прокси
app.use(requestTimeout());

// Загруженные картинки: /uploads/<файл> (см. utils/uploads.js).
// SVG отдаём с запретом скриптов и плагинов: файл лежит на том же домене,
// а значит без заголовка мог бы выполнить чужой код при прямом открытии.
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (filePath.toLowerCase().endsWith('.svg')) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  }),
);
app.use('/uploads', (req, res) => res.status(404).json({ message: 'Файл не найден' }));

/**
 * Жива ли база. Сервер без базы отвечает 200 на «/api/health», хотя любой
 * запрос данных падает — именно так 502 и появлялся: процесс жив, данные нет.
 */
async function databaseReady(timeoutMs = 2000) {
  let timer;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('database timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/health', async (req, res) => {
  const ready = await databaseReady();

  if (!ready) {
    return res
      .status(503)
      .set('Retry-After', '2')
      .json({ status: 'degraded', database: 'unavailable', time: new Date().toISOString() });
  }

  return res.json({ status: 'ok', database: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/blocks', blockRoutes);
app.use('/api/slides', slideRoutes);
app.use('/api/contents', contentRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/test-groups', testGroupRoutes);
app.use('/api/test-sections', testSectionRoutes);
app.use('/api/test-settings', testSettingsRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/memo-slides', memoSlideRoutes);
app.use('/api/memo-cells', memoRoutes);
app.use('/api/terms', glossaryRoutes);
app.use('/api/themes', themeRoutes);

// 404 для неизвестных API-роутов
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Маршрут не найден' });
});

// Ошибки Prisma «база недоступна/занята» — временные: отвечаем 503 с
// Retry-After, чтобы клиент повторил GET, а не показывал красную ошибку.
const UNAVAILABLE_CODES = new Set([
  'P1001', // сервер БД недоступен
  'P1002', // таймаут соединения
  'P1008', // таймаут операции
  'P1017', // соединение закрыто сервером
  'P2024', // нет свободного соединения в пуле
  'P2028', // транзакция не завершилась
]);

/** Ошибка «база недоступна»: Prisma-коды и сбой инициализации клиента. */
function isDatabaseUnavailable(error) {
  if (UNAVAILABLE_CODES.has(error?.code)) return true;
  if (error?.name === 'PrismaClientInitializationError') return true;
  return error?.message === 'database timeout';
}

// Централизованная обработка ошибок
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  // Битый или слишком большой JSON — виноват клиент, а не сервер
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Некорректный JSON в теле запроса' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Тело запроса слишком большое' });
  }

  if (isDatabaseUnavailable(error)) {
    console.warn(`[error] ${req.method} ${req.originalUrl}: база недоступна (${error?.code ?? error?.name ?? error?.message})`);
    return res
      .status(503)
      .set('Retry-After', '2')
      .json({ message: 'Сервер временно недоступен. Повторите попытку.' });
  }

  const status = Number(error?.status);

  // 4xx из контроллеров и middleware: сообщение можно показывать пользователю
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      message: error.message ?? 'Некорректный запрос',
      ...(error.errors ? { errors: error.errors } : {}),
    });
  }

  // 5xx: подробности остаются в консоли сервера, пользователю — короткий текст
  console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  return res.status(500).json({ message: 'Внутренняя ошибка сервера. Повторите попытку.' });
});

export default app;
