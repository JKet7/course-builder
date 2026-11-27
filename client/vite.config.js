import net from 'node:net';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Куда проксировать API. По умолчанию — локальный Express (PORT из server/.env).
// Переменная нужна проверкам и запуску API на другом порту.
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4000';

const API_URL = new URL(API_TARGET);
const API_PORT = Number(API_URL.port || 80);

/** Сколько ждём, пока API поднимется, прежде чем честно ответить 503 (мс). */
const API_WAIT_MS = 5000;

/** Одна проверка порта API — не дольше этого (мс). */
const API_PROBE_TIMEOUT_MS = 300;

/** Пауза между проверками порта API (мс). */
const API_PROBE_DELAY_MS = 200;

/** Проверка прошла — следующую делаем не раньше, чем через это время (мс). */
const API_PROBE_CACHE_MS = 1500;

/** Открыт ли порт API: соединение устанавливается, значит Express слушает. */
function isApiPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: API_URL.hostname, port: API_PORT });
    let settled = false;

    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(API_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Пауза вместо ошибки: не проксируем запрос, пока API не поднялся.
 *
 * `node --watch` перезапускает Express на каждое сохранение файла, а
 * «Запустить сервер.bat» открывает браузер, не дожидаясь API. В это окно
 * (0.5–2 с) прокси получал ECONNREFUSED, отдавал 503, и в консоли браузера
 * появлялась красная «Failed to load resource: 503» на /api/questions.
 *
 * Теперь запрос ждёт появления порта API (до API_WAIT_MS) и уходит в Express
 * как обычно — данные загружаются, ошибки в консоли нет. Если API так и не
 * поднялся, отдаём прежний понятный 503 (см. handleProxyError).
 *
 * /api/health не ждёт: это сама проверка «жив ли API», она должна отвечать сразу.
 */
function waitForApi() {
  let apiReadyUntil = 0;

  return {
    name: 'course-builder-wait-for-api',
    apply: 'serve',
    configureServer(server) {
      // Этот middleware встаёт до прокси Vite: см. порядок хуков в configureServer
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';

        if (!url.startsWith('/api') || url.startsWith('/api/health')) return next();
        if (Date.now() < apiReadyUntil) return next();

        const deadline = Date.now() + API_WAIT_MS;

        const attempt = async () => {
          // Клиент уже ушёл (перезагрузка страницы) — проверять нечего
          if (res.headersSent || res.writableEnded) return;

          if (await isApiPortOpen()) {
            apiReadyUntil = Date.now() + API_PROBE_CACHE_MS;
            return next();
          }

          // Время вышло — пусть прокси отдаст 503 с Retry-After
          if (Date.now() >= deadline) return next();

          setTimeout(attempt, API_PROBE_DELAY_MS);
        };

        attempt();
      });
    },
  };
}

/**
 * Ошибка прокси — это ещё не ответ API: Express мог не запуститься или
 * перезапускаться (node --watch). Штатный Vite в этом случае отдаёт браузеру
 * 502 Bad Gateway, и в консоли страницы появляется техническая ошибка.
 *
 * Вместо этого отвечаем 503 с понятным JSON и Retry-After: клиент показывает
 * «Сервер временно недоступен» и сам повторяет GET-запрос (см. api/axios.js).
 */
function handleProxyError(proxy) {
  proxy.on('error', (error, req, res) => {
    console.warn(`[proxy] ${req?.method ?? ''} ${req?.url ?? ''}: ${error?.code || error?.message}`);

    const response = res;
    if (!response || typeof response.writeHead !== 'function' || response.headersSent) {
      response?.socket?.destroy?.();
      return;
    }

    response.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '2',
    });
    response.end(JSON.stringify({ message: 'Сервер временно недоступен. Повторите попытку.' }));
  });
}

export default defineConfig({
  plugins: [react(), waitForApi()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: handleProxyError,
      },
      // Загруженные картинки отдаёт тот же Express (server/uploads)
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
        configure: handleProxyError,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

