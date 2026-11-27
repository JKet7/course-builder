import axios from 'axios';

export const TOKEN_KEY = 'cb_token';
export const USER_KEY = 'cb_user';

/** Таймаут запроса: без него зависший сервер держит спиннер бесконечно. */
const REQUEST_TIMEOUT = 20000;

/** Проверка «жив ли API» быстрая: ждать её 20 секунд бессмысленно. */
const HEALTH_TIMEOUT = 5000;

/**
 * Паузы перед повтором запроса при временной ошибке — три повтора.
 *
 * `node --watch` перезапускает Express на каждое сохранение файла на сервере:
 * 1–2 секунды API не отвечает, прокси отдаёт 503. Суммарное ожидание здесь —
 * около 6 секунд, поэтому такой перезапуск проходит незаметно для пользователя.
 */
const RETRY_DELAYS = [500, 1500, 4000];

/** Коды ответов, при которых идемпотентный запрос имеет смысл повторить. */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Методы, которые можно повторять без риска для данных.
 *
 * GET и HEAD ничего не меняют. PUT и DELETE идемпотентны по стандарту HTTP:
 * повтор с тем же телом приводит к тому же состоянию (переименование, порядок
 * карточек, настройки, удаление). POST и PATCH не повторяем — они создают новую
 * запись или меняют только часть полей, и повтор мог бы задвоить результат.
 */
const RETRY_METHODS = new Set(['get', 'head', 'put', 'delete']);


/** Технические тексты axios: пользователю их показывать нельзя. */
const TECHNICAL_MESSAGE = /Request failed with status code|Network Error|timeout of \d+ ?ms exceeded|ERR_NETWORK/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: REQUEST_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

// Токен подставляем из localStorage, чтобы не зависеть от стора (нет циклического импорта)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Сервер не ответил вовсе: нет сети, прокси не достучался, соединение сброшено. */
export function isNetworkError(error) {
  return Boolean(error) && !error.response;
}

/** Запрос не уложился в таймаут (axios отдаёт ECONNABORTED/ETIMEDOUT). */
export function isTimeoutError(error) {
  const code = error?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

/**
 * Временная ошибка — такую попытку можно повторить без риска для данных:
 * шлюз не дождался API (502/503/504), сервер перегружен (429) или упал (500).
 */
export function isTransientError(error) {
  if (!error) return false;

  const status = error.response?.status;
  if (status) return RETRY_STATUSES.has(status);

  return isNetworkError(error) || isTimeoutError(error);
}

/**
 * Характер ошибки для интерфейса:
 * offline — сервер не ответил (нет связи/таймаут), server — 5xx, request — ответ 4xx.
 */
export function errorKindOf(error) {
  if (!error) return null;

  const status = error.response?.status;
  if (!status) return 'offline';
  return status >= 500 ? 'server' : 'request';
}

/**
 * «Жив ли API» — один дешёвый запрос вместо пачки.
 *
 * Экран теста грузится четырьмя запросами сразу (группы, разделы, настройки,
 * вопросы). Если Express перезапускается (`node --watch`), все четыре падают,
 * повторяются и забивают консоль браузера красными «503», а пользователь
 * получает четыре одинаковые ошибки. Поэтому сначала проверяем `/api/health`
 * (он же смотрит на базу): не ответил — остальные запросы не отправляем.
 * Повторы у проверки обычные, так что короткий перезапуск сервера не страшен.
 */
export function checkApi() {
  return api.get('/health', { timeout: HEALTH_TIMEOUT });
}

// 401 → сессия недействительна: чистим токен и уходим на логин.
// Временные ошибки повторяем сами: прокси мог не застать API (перезапуск),
// а база — на секунду занять файл. Какие методы повторять — см. RETRY_METHODS.
api.interceptors.response.use(
  async (response) => response,
  async (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url ?? '');
    const config = error.config;

    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
      return Promise.reject(error);
    }

    const attempt = config?.__retry ?? 0;
    const retryable =
      config &&
      RETRY_METHODS.has(String(config.method ?? '').toLowerCase()) &&
      config.retry !== false &&
      attempt < RETRY_DELAYS.length &&
      isTransientError(error);

    if (!retryable) return Promise.reject(error);

    config.__retry = attempt + 1;
    await sleep(RETRY_DELAYS[attempt]);
    return api.request(config);
  },
);

/**
 * Текст ошибки для пользователя.
 *
 * Ответы сервера (валидация, 403, 404) показываем как есть, а технические
 * сообщения axios и шлюза заменяем понятными фразами: «Request failed with
 * status code 502» ничего не говорит читателю и пугает его.
 */
export function getErrorMessage(error, fallback = 'Что-то пошло не так') {
  const data = error?.response?.data;

  if (data?.errors && typeof data.errors === 'object') {
    const firstError = Object.values(data.errors)[0];
    if (firstError) return String(firstError);
  }

  const status = error?.response?.status;

  if (status === 502 || status === 503 || status === 504) {
    return 'Сервер временно недоступен. Попробуйте ещё раз через несколько секунд.';
  }
  if (status === 500) {
    return 'Сервер не смог обработать запрос. Попробуйте ещё раз.';
  }
  if (status === 429) {
    return 'Слишком много запросов. Подождите немного и повторите.';
  }
  if (data?.message) {
    return String(data.message);
  }

  if (!status) {
    return isTimeoutError(error)
      ? 'Сервер не ответил вовремя. Проверьте, запущен ли сервер, и повторите попытку.'
      : 'Нет связи с сервером. Проверьте, запущен ли сервер, и повторите попытку.';
  }

  const message = String(error?.message ?? '');
  return !message || TECHNICAL_MESSAGE.test(message) ? fallback : message;
}

export default api;

