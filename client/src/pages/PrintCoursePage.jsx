import { useEffect, useMemo } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import ContentRenderer, { TiptapContent } from '../components/content/ContentRenderer.jsx';
import MemoTitle from '../components/memo/MemoTitle.jsx';
import RichText from '../components/content/RichText.jsx';
import Button from '../components/ui/Button.jsx';
import Icon from '../components/ui/Icon.jsx';
import { useAuthStore } from '../store/authStore.js';
import { usePrintStore } from '../store/printStore.js';
import {
  buildContentRows,
  contentRowSpans,
  formatDate,
  getBlockTypeLabel,
  getQuestionTypeLabel,
  normalizeContentData,
  pluralize,
  sortTerms,
} from '../utils/helpers.js';
import { collectNotes, collectPlainNotes, collectSlideNotes, plainNoteNumbers } from '../utils/notes.js';
import { collectPlainLinks } from '../utils/links.js';
import { contentBodyContents } from '../utils/contentBody.js';

/**
 * Фрагмент контента в печати. Видео — ссылка (iframe в PDF бесполезен),
 * пустая картинка — короткая пометка вместо рамки «Картинка не добавлена».
 * noteOffset — примечания предыдущих фрагментов слайда (номера сквозные).
 */
function PrintContent({ content, noteOffset = 0 }) {
  const data = normalizeContentData(content.type, content.data);

  if (content.type === 'video') {
    const numberById = plainNoteNumbers(data, noteOffset);

    return (
      <div className="print-video">
        <span className="print-label">Видео</span>
        {data.url ? (
          <a href={data.url} target="_blank" rel="noopener noreferrer">
            {data.url}
          </a>
        ) : (
          <p className="print-empty">Ссылка не добавлена</p>
        )}
        {data.caption && (
          <p className="print-video__caption">
            <RichText
              value={data.caption}
              notes={collectPlainNotes(data)}
              links={collectPlainLinks(data)}
              field="caption"
              refId=""
              numberById={numberById}
            />
          </p>
        )}
      </div>
    );
  }

  if (content.type === 'image' && !data.url) {
    return <p className="print-empty">Картинка не добавлена</p>;
  }

  return <ContentRenderer content={content} noteOffset={noteOffset} />;
}

/** Раскладка контента слайда: те же ряды и ширины, что в редакторе. */
function PrintContents({ contents, noteOffset = 0 }) {
  // Строки слайда + колонки сетки (33 % → 4 колонки из 12), как в ContentGrid
  const rows = useMemo(
    () => buildContentRows(contents).map((row) => ({ ...row, spans: contentRowSpans(row.items) })),
    [contents],
  );
  // Номера примечаний сквозные по слайду — как в редакторе и режиме чтения
  const noteOffsets = useMemo(
    () => collectSlideNotes(contents, noteOffset).offsetById,
    [contents, noteOffset],
  );

  return rows.map((row) => (
    <div className="print-row" key={row.items.map((item) => item.id).join('-')}>
      {row.items.map((content, index) => (
        <div key={content.id} className="print-cell" style={{ gridColumn: `span ${row.spans[index]}` }}>
          <PrintContent content={content} noteOffset={noteOffsets.get(content.id) ?? 0} />
        </div>
      ))}
    </div>
  ));
}

/** Блок «Теория»: все слайды подряд, каждый — со своим контентом. */
function PrintTheory({ block }) {
  if (block.slides.length === 0) {
    return <p className="print-empty">В блоке пока нет слайдов.</p>;
  }

  return block.slides.map((slide, index) => (
    <section className="print-slide" key={slide.id}>
      <h3 className="print-slide__title">
        <span className="print-slide__index">{index + 1}</span>
        {slide.title || 'Слайд без названия'}
      </h3>

      {slide.contents.length === 0 ? (
        <p className="print-empty">На слайде нет материалов.</p>
      ) : (
        <PrintContents contents={slide.contents} />
      )}
    </section>
  ));
}

/** Блок «Тест»: вопросы с вариантами; ответы — по переключателю. */
function PrintQuestion({ question, index, answers }) {
  const data = question.data ?? {};
  const options = question.options ?? [];
  const pairs = question.pairs ?? [];

  return (
    <article className="print-question">
      <header className="print-question__head">
        <span className="print-question__num">{index + 1}.</span>
        <span className="print-question__type">{getQuestionTypeLabel(question.type)}</span>
        {question.group?.name && <span className="print-question__group">{question.group.name}</span>}
      </header>

      {question.type === 'card' ? (
        <dl className="print-qcard">
          <dt className="print-label">Вопрос</dt>
          <dd>{data.front || '—'}</dd>
          {answers && (
            <>
              <dt className="print-label">Ответ</dt>
              <dd>{data.back || '—'}</dd>
            </>
          )}
        </dl>
      ) : (
        <>
          <p className="print-question__text">{data.text || '—'}</p>

          {question.type === 'match' ? (
            pairs.length > 0 && (
              <table className="print-pairs">
                <tbody>
                  {pairs.map((pair) => (
                    <tr key={pair.id}>
                      <td>{pair.left}</td>
                      <td>{pair.right}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <ul className="print-options">
              {options.map((option) => {
                const correct = answers && option.isCorrect;

                return (
                  <li key={option.id} className={correct ? 'print-option is-correct' : 'print-option'}>
                    <span className="print-option__mark" aria-hidden="true">
                      {correct ? '✓' : ''}
                    </span>
                    <span>{option.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {answers && question.explanation && (
        <div className="print-question__explanation">
          <span className="print-label">Пояснение</span>
          <TiptapContent doc={question.explanation} />
        </div>
      )}
    </article>
  );
}

function PrintTest({ block, answers }) {
  if (block.questions.length === 0) {
    return <p className="print-empty">В блоке пока нет вопросов.</p>;
  }

  return block.questions.map((question, index) => (
    <PrintQuestion key={question.id} question={question} index={index} answers={answers} />
  ));
}

/** Блок «Памятка»: слайды, в каждом — сетка карточек (все типы контента). */
function PrintMemo({ block }) {
  if (block.memoSlides.length === 0) {
    return <p className="print-empty">В блоке пока нет слайдов.</p>;
  }

  return block.memoSlides.map((slide, slideIndex) => (
    <section className="print-memo" key={slide.id}>
      <h3 className="print-memo__title">
        Слайд {slideIndex + 1}. {slide.title}
      </h3>

      {slide.cells.length > 0 ? (
        <div className="print-memo__cards">
          {slide.cells.map((cell) => (
            <article className="print-memo__card" key={cell.id}>
              <MemoTitle
                title={cell.title}
                titleDoc={cell.titleDoc}
                className="print-memo__card-title"
                fallback="Без названия"
              />
              <PrintContents
                contents={contentBodyContents(cell.body, cell.id)}
                noteOffset={collectNotes(cell.titleDoc).length}
              />
            </article>
          ))}
        </div>
      ) : (
        <p className="print-empty">На слайде нет карточек.</p>
      )}
    </section>
  ));
}

/** Блок «Глоссарий»: термины по алфавиту (как в редакторе). */
function PrintGlossary({ block }) {
  const terms = useMemo(() => sortTerms(block.terms), [block.terms]);

  if (terms.length === 0) {
    return <p className="print-empty">В блоке пока нет терминов.</p>;
  }

  return (
    <dl className="print-glossary">
      {terms.map((term) => (
        <div className="print-glossary__item" key={term.id}>
          <dt>{term.term}</dt>
          <dd>
            <PrintContents contents={contentBodyContents(term.definition, term.id)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Один блок документа: заголовок, описание, обложка и содержимое по типу. */
function PrintBlock({ block, index, answers }) {
  return (
    <section className={`print-block print-block--${block.type}`}>
      <header className="print-block__head">
        <h2 className="print-block__title">
          {index + 1}. {block.title}
        </h2>
        <span className="print-block__type">{getBlockTypeLabel(block.type)}</span>
      </header>

      {block.description && <p className="print-block__description">{block.description}</p>}

      {block.coverImage && <img className="print-block__cover" src={block.coverImage} alt="" />}

      {block.type === 'theory' && <PrintTheory block={block} />}
      {block.type === 'test' && <PrintTest block={block} answers={answers} />}
      {block.type === 'memo' && <PrintMemo block={block} />}
      {block.type === 'glossary' && <PrintGlossary block={block} />}
    </section>
  );
}

/** Панель управления: в печать не попадает (см. styles/print.css). */
function PrintToolbar({ course, courseId, loading, showAnswers, onAnswersChange, onPrint }) {
  return (
    <header className="print-toolbar">
      <Link className="btn btn--ghost btn--sm" to={`/course/${courseId}`}>
        <Icon name="arrowLeft" size={16} />
        К курсу
      </Link>

      <span className="print-toolbar__title">{course?.title ?? 'Печать курса'}</span>

      <label className="print-toolbar__answers">
        <input
          type="checkbox"
          checked={showAnswers}
          onChange={(event) => onAnswersChange(event.target.checked)}
        />
        Ответы теста
      </label>

      <div className="print-toolbar__spacer" />

      <Button size="sm" onClick={onPrint} disabled={!course || loading}>
        <Icon name="printer" size={16} />
        Печать / Сохранить в PDF
      </Button>
    </header>
  );
}

/** Документ целиком: шапка, содержание, блоки и подвал. */
function PrintDocument({ course, generatedAt, showAnswers }) {
  const blocks = course.blocks ?? [];

  return (
    <article className="print-doc">
      <header className="print-doc__head">
        <h1 className="print-doc__title">{course.title}</h1>
        {course.description && <p className="print-doc__description">{course.description}</p>}

        <p className="print-doc__meta">
          <span>
            {blocks.length} {pluralize(blocks.length, ['блок', 'блока', 'блоков'])}
          </span>
          {course.updatedAt && <span>Обновлён {formatDate(course.updatedAt)}</span>}
          {generatedAt && <span>Документ от {formatDate(generatedAt)}</span>}
        </p>
      </header>

      {blocks.length === 0 ? (
        <p className="print-empty">В курсе пока нет блоков.</p>
      ) : (
        <nav className="print-toc">
          <p className="print-toc__title">Содержание</p>
          <ol>
            {blocks.map((block) => (
              <li key={block.id}>
                <span>{block.title}</span>
                <span className="print-toc__type">{getBlockTypeLabel(block.type)}</span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {blocks.map((block, index) => (
        <PrintBlock key={block.id} block={block} index={index} answers={showAnswers} />
      ))}

      <footer className="print-doc__footer">
        Конструктор курсов
        {generatedAt ? ` · документ сформирован ${formatDate(generatedAt)}` : ''}
      </footer>
    </article>
  );
}

/**
 * Страница печати курса (Шаг 15). Открывается в новой вкладке из меню карточки
 * курса или кнопки на странице курса; с `?print=1` сразу вызывает диалог печати,
 * и браузер сохраняет документ в PDF (кириллица и картинки — его средствами).
 */
export default function PrintCoursePage() {
  const { courseId } = useParams();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const course = usePrintStore((state) => state.course);
  const generatedAt = usePrintStore((state) => state.generatedAt);
  const loading = usePrintStore((state) => state.loading);
  const loaded = usePrintStore((state) => state.loaded);
  const error = usePrintStore((state) => state.error);
  const notFound = usePrintStore((state) => state.notFound);
  const showAnswers = usePrintStore((state) => state.showAnswers);
  const setShowAnswers = usePrintStore((state) => state.setShowAnswers);
  const fetchPrintCourse = usePrintStore((state) => state.fetchPrintCourse);
  const reset = usePrintStore((state) => state.reset);

  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    fetchPrintCourse(courseId);
    return () => reset();
  }, [courseId, isAuthenticated, fetchPrintCourse, reset]);

  useEffect(() => {
    if (!course) return undefined;

    const previous = document.title;
    document.title = `${course.title} — печать`;
    return () => {
      document.title = previous;
    };
  }, [course]);

  useEffect(() => {
    if (!autoPrint || !course) return undefined;

    const timer = setTimeout(() => window.print?.(), 500);
    return () => clearTimeout(timer);
  }, [autoPrint, course]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `/course/${courseId}/print` }} />;
  }

  const current = course?.id === courseId ? course : null;
  const missing = loaded && !current && !error && !loading;

  return (
    <div className="print-app">
      <PrintToolbar
        course={current}
        courseId={courseId}
        loading={loading}
        showAnswers={showAnswers}
        onAnswersChange={setShowAnswers}
        onPrint={() => window.print?.()}
      />

      {loading && !current && <p className="print-status">Готовим документ…</p>}

      {error && (
        <div className="print-status">
          <div className="alert alert--error" role="alert">
            <Icon name="alert" size={18} />
            <span className="alert__text">{error}</span>
            <Button variant="ghost" size="sm" onClick={() => fetchPrintCourse(courseId)}>
              Повторить
            </Button>
          </div>
        </div>
      )}

      {(notFound || missing) && (
        <div className="print-status empty-state empty-state--center">
          <Icon name="alert" size={32} />
          <p className="empty-state__title">Курс не найден</p>
          <p>Возможно, его удалили или ссылка устарела.</p>
          <Link to="/" className="btn btn--secondary btn--sm">
            <Icon name="arrowLeft" size={16} />
            К списку курсов
          </Link>
        </div>
      )}

      {current && <PrintDocument course={current} generatedAt={generatedAt} showAnswers={showAnswers} />}
    </div>
  );
}

