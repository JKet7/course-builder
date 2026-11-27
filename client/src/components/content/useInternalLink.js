import { useCallback, useContext } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { useLinkStore } from '../../store/linkStore.js';
import { internalHref } from '../../utils/links.js';
import { useOptionalLocation } from '../../utils/router.js';

/**
 * Переход по внутренней ссылке (Правка 6).
 *
 * Запоминает текущее место в истории переходов (шапка показывает «← Назад»)
 * и открывает целевой блок, слайд, вопрос, ячейку памятки или термин.
 * Работает и вне <Router> (SSR-проверки): тогда перехода просто нет.
 * Используется только в просмотре: печать обработчик не передаёт.
 */
export function useInternalLink() {
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator ?? null;
  const location = useOptionalLocation();
  const pathname = location?.pathname ?? '';
  const search = location?.search ?? '';

  return useCallback(
    (link) => {
      const href = link?.href || internalHref(link);
      if (!href || !navigator) return;

      useLinkStore.getState().pushHistory({ pathname, search });
      navigator.push(href);
    },
    [navigator, pathname, search],
  );
}
