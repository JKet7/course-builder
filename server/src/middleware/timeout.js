/**
 * Страховка от зависших запросов чтения.
 *
 * Если обработчик (обычно запрос к SQLite) не ответил за отведённое время,
 * Express держит соединение открытым, а браузер и прокси Vite считают это
 * ошибкой шлюза (502/504). Вместо этого отвечаем 503 с Retry-After: клиент
 * понимает, что сервер жив, и повторяет GET-запрос сам (api/axios.js).
 *
 * Таймаут ставится только на чтение (GET/HEAD): прерывать запись, которая уже
 * могла примениться в базе, нельзя — повтор создал бы дубликат.
 */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 15000);

const READ_METHODS = new Set(['GET', 'HEAD']);

export function requestTimeout(ms = REQUEST_TIMEOUT_MS) {
  return (req, res, next) => {
    if (!READ_METHODS.has(req.method)) return next();

    const timer = setTimeout(() => {
      // Заголовки уже ушли — ответ не переписать, пусть запрос завершится сам
      if (res.headersSent || res.writableEnded) return;

      res
        .status(503)
        .set('Retry-After', '2')
        .json({ message: 'Сервер не успел обработать запрос. Повторите попытку.' });
    }, ms);

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    timer.unref?.();

    return next();
  };
}

export default requestTimeout;
