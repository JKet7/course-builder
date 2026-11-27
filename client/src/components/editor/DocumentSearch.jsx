import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { pluralize } from '../../utils/helpers.js';
import { SEARCH_LIMIT, SEARCH_MIN_QUERY, searchSlides } from '../../utils/search.js';

/**
 * Шаг 17: панель поиска по документу теории.
 *
 * Ищет по названиям слайдов и всем фрагментам контента, показывает сниппет
 * с подсвеченным совпадением. Стрелки выбирают результат, Enter открывает
 * слайд и прокручивает к фрагменту, Esc закрывает панель.
 *
 * initialQuery — только стартовое значение (используется в SSR-проверках),
 * дальше состоянием владеет сама панель.
 */
export default function DocumentSearch({
  slides = [],
  activeSlideId = null,
  initialQuery = '',
  placeholder = 'Найти в теории — минимум 2 символа',
  ariaLabel = 'Найти в теории',
  onSelect,
  onClose,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const trimmed = query.trim();
  const ready = trimmed.length >= SEARCH_MIN_QUERY;
  const { results, total } = useMemo(() => searchSlides(slides, query), [slides, query]);
  const currentIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Держим выбранный стрелками результат в видимой части списка.
  useEffect(() => {
    if (currentIndex < 0) return;
    listRef.current?.querySelector(`[data-search-index="${currentIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [currentIndex]);

  const pick = (index) => {
    const result = results[index];
    if (result) onSelect?.(result);
  };

  const handleKeyDown = (event) => {
    if (results.length === 0) {
      if (event.key === 'Escape') onClose?.();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(currentIndex + 1, results.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      // Кнопка результата сама вызовет onSelect через onClick — не дублируем.
      if (event.target?.tagName === 'BUTTON') return;

      event.preventDefault();
      pick(currentIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  };

  const counter = !ready
    ? 'Ctrl + F'
    : `${total} ${pluralize(total, ['совпадение', 'совпадения', 'совпадений'])}${
        total > results.length ? ` · показано ${SEARCH_LIMIT}` : ''
      }`;

  return (
    <section className="doc-search" aria-label="Поиск по документу" onKeyDown={handleKeyDown}>
      <div className="doc-search__bar">
        <Icon name="search" size={16} className="doc-search__icon" />

        <input
          ref={inputRef}
          type="search"
          className="input doc-search__input"
          value={query}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />

        <span className="doc-search__count" aria-live="polite">
          {counter}
        </span>

        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть поиск">
          <Icon name="x" size={16} />
        </Button>
      </div>

      {!ready && (
        <p className="doc-search__state">
          Поиск идёт по названиям слайдов, карточек и всем фрагментам: тексту, таблицам, чек-листам, коду и подписям.
        </p>
      )}

      {ready && results.length === 0 && (
        <p className="doc-search__state">Ничего не найдено по запросу «{trimmed}».</p>
      )}

      {results.length > 0 && (
        <ul className="doc-search__list" role="listbox" aria-label="Результаты поиска" ref={listRef}>
          {results.map((result, index) => (
            <li key={result.key} role="presentation">
              <button
                type="button"
                role="option"
                data-search-index={index}
                aria-selected={index === currentIndex}
                aria-current={result.slideId === activeSlideId ? 'true' : undefined}
                className={index === currentIndex ? 'doc-search__item is-active' : 'doc-search__item'}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(index)}
              >
                <span className="doc-search__meta">
                  <span className="doc-search__slide">Слайд {result.slideIndex + 1}</span>
                  <span className="doc-search__type">
                    {result.contentId ? result.contentLabel : 'Название слайда'}
                  </span>
                </span>

                <span className="doc-search__title">{result.slideTitle}</span>

                {result.snippet && (
                  <span className="doc-search__snippet">
                    {result.snippet.before}
                    {result.snippet.match && <mark className="doc-search__match">{result.snippet.match}</mark>}
                    {result.snippet.after}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {results.length > 0 && (
        <p className="doc-search__hint">Enter — открыть, Esc — закрыть, стрелки — выбор результата.</p>
      )}
    </section>
  );
}
