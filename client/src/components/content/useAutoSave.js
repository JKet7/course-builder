import { useCallback, useEffect, useRef, useState } from 'react';

/** Подписи статуса автосохранения. */
export const SAVE_STATUS_LABELS = {
  idle: '',
  pending: 'Есть несохранённые изменения…',
  saving: 'Сохраняем…',
  saved: 'Сохранено',
  error: 'Не удалось сохранить',
};

/**
 * Автосохранение с задержкой (по умолчанию 700 мс).
 * `queue(data)` запоминает последние данные; `flushNow()` отправляет их сразу.
 * При размонтировании несохранённые данные тоже уходят на сервер.
 */
export default function useAutoSave(onSave, { delay = 700 } = {}) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const pending = useRef(null);
  const saveRef = useRef(onSave);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const flush = useCallback(async () => {
    if (!pending.current) return null;

    const data = pending.current;
    pending.current = null;
    setStatus('saving');

    const result = await saveRef.current?.(data);
    setStatus(result && result.ok === false ? 'error' : 'saved');
    return result ?? null;
  }, []);

  const queue = useCallback(
    (data) => {
      pending.current = data;
      setStatus('pending');

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, delay);
    },
    [delay, flush],
  );

  const flushNow = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return flush();
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      // Последнее изменение не теряем: отправляем при уходе с карточки/слайда
      if (pending.current) saveRef.current?.(pending.current);
      pending.current = null;
    },
    [],
  );

  return { status, queue, flushNow };
}
