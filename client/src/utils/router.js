import { useContext, useMemo } from 'react';
import { UNSAFE_LocationContext } from 'react-router-dom';

/**
 * Текущий адрес без требования <Router> (Правка 6).
 *
 * Блоки теории, теста, памятки и глоссария рендерятся и вне роутера —
 * в SSR-проверках (scripts/render-check.mjs) и editor-check. Хук useSearchParams
 * в таком окружении бросает исключение, а чтение контекста — нет:
 * вне роутера просто возвращаются пустые параметры.
 */
export function useOptionalLocation() {
  return useContext(UNSAFE_LocationContext)?.location ?? null;
}

/** Параметры строки запроса (?slide=, ?question=, ?memo=, ?term=). */
export function useOptionalSearchParams() {
  const search = useOptionalLocation()?.search ?? '';
  return useMemo(() => new URLSearchParams(search), [search]);
}
