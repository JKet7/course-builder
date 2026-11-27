import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { TiptapContent } from '../content/ContentRenderer.jsx';
import { formatDuration, questionTitle } from '../../utils/testRun.js';

const STATUS_LABELS = {
  correct: 'Верно',
  wrong: 'Неверно',
  answered: 'Отвечено',
  empty: 'Без ответа',
};

/** Цвет кольца с процентом: зелёный, жёлтый или красный. */
function scoreTone(percent) {
  if (percent >= 80) return 'good';
  if (percent >= 50) return 'mid';
  return 'bad';
}

/**
 * Итоги попытки: процент (в тесте с оценкой) или число отвеченных вопросов,
 * время, статистика по группам, раскрывающаяся детализация по каждому вопросу,
 * итоговый комментарий автора и переходы. В режиме ветвления оценки нет:
 * правильные ответы не показываются, проценты и группы не считаются, зато
 * первым блоком идёт итог пройденного пути — заголовок раздела и его описание.
 */
export default function ReaderResults({ block, results, nextBlock, onRestart }) {
  const graded = results.graded !== false;
  const tone = graded ? scoreTone(results.percent) : 'neutral';
  const unanswered = Math.max(0, results.total - results.answered);
  const courseId = block.courseId ?? block.course?.id ?? null;
  // Ветвление: итог — раздел, в котором закончился путь, и его описание.
  const resultTitle = graded ? null : results.resultTitle;

  const resultBlock = results.result ? (
    <section className="test-results__comment">
      <span className="test-results__label">{graded ? 'Комментарий' : 'Итог'}</span>
      <TiptapContent doc={results.result} />
    </section>
  ) : null;

  return (
    <div className="test-results">
      <section className="test-results__hero">
        <div
          className={`test-results__score is-${tone}`}
          aria-label={graded ? `Результат ${results.percent} процентов` : `Отвечено ${results.answered} из ${results.total}`}
        >
          <strong>{graded ? `${results.percent}%` : `${results.answered}/${results.total}`}</strong>
          <span>{graded ? 'результат' : 'отвечено'}</span>
        </div>

        <div className="test-results__hero-body">
          <span className="test-results__eyebrow">{graded ? 'Тест завершён' : 'Ваш результат'}</span>
          <h2 className="test-results__title">{resultTitle ?? block.title}</h2>
          <p className="test-results__hint">
            {graded
              ? `Верно ${results.correct} из ${results.answered} отвеченных · время ${formatDuration(results.elapsed)}`
              : `Отвечено ${results.answered} из ${results.total} · время ${formatDuration(results.elapsed)}`}
          </p>

          <div className="test-results__facts">
            {graded ? (
              <>
                <span className="test-results__fact is-correct">
                  <Icon name="check" size={16} /> {results.correct} верно
                </span>
                <span className="test-results__fact is-wrong">
                  <Icon name="x" size={16} /> {results.wrong} ошибок
                </span>
              </>
            ) : (
              <span className="test-results__fact">
                <Icon name="check" size={16} /> {results.answered} отвечено
              </span>
            )}

            <span className="test-results__fact is-empty">
              <Icon name="circle" size={16} /> {unanswered} без ответа
            </span>

            <span className="test-results__fact">{results.total} вопросов</span>

            {!graded && <span className="test-results__fact">Оценка не выставляется</span>}
          </div>
        </div>
      </section>

      {/* В ветвлении итог пути показывается сразу под шапкой — это главное на экране. */}
      {!graded && resultBlock}

      {graded && results.groups.length > 0 && (
        <section className="test-results__section" aria-label="Статистика по группам">
          <h3 className="test-results__section-title">По группам</h3>

          <div className="test-results__groups">
            {results.groups.map((group) => (
              <article className="test-results__group" key={group.id}>
                <header className="test-results__group-head">
                  <span className="test-results__group-name">{group.name}</span>
                  <strong className="test-results__group-percent">{group.percent}%</strong>
                </header>

                <div
                  className="test-results__bar"
                  role="progressbar"
                  aria-valuenow={group.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${group.percent}%` }} />
                </div>

                <span className="test-results__group-hint">
                  {group.correct} из {group.answered} отвеченных · всего {group.total}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="test-results__section" aria-label="Детализация по вопросам">
        <h3 className="test-results__section-title">Разбор ответов</h3>

        <div className="test-results__details">
          {results.details.map((detail, index) => {
            const status = detail.verdict ?? 'empty';

            return (
              <details className={`test-results__item is-${status}`} key={detail.id}>
                <summary className="test-results__summary">
                  <span className="test-results__num">{index + 1}</span>
                  <span className="test-results__question">{questionTitle(detail.question)}</span>
                  <span className={`test-results__status is-${status}`}>{STATUS_LABELS[status]}</span>
                  <Icon name="chevronDown" size={16} className="test-results__chevron" />
                </summary>

                <div className="test-results__body">
                  <p className="test-results__row">
                    <span className="test-results__label">Ваш ответ</span>
                    <span>{detail.answer || 'Нет ответа'}</span>
                  </p>

                  {graded && (
                    <p className="test-results__row">
                      <span className="test-results__label">Правильный ответ</span>
                      <span>{detail.correct}</span>
                    </p>
                  )}

                  {detail.question.explanation && (
                    <div className="test-results__explanation">
                      <TiptapContent doc={detail.question.explanation} />
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {graded && resultBlock}

      <div className="test-results__actions">
        <Button variant="secondary" onClick={onRestart}>
          <Icon name="refresh" size={16} />
          Пройти заново
        </Button>

        {courseId && (
          <Link className="btn btn--ghost" to={`/course/${courseId}`}>
            <Icon name="arrowLeft" size={16} />
            К курсу
          </Link>
        )}

        {nextBlock && (
          <Link className="btn btn--primary" to={`/block/${nextBlock.id}`}>
            Следующий блок
            <Icon name="arrowRight" size={16} />
          </Link>
        )}
      </div>
    </div>
  );
}
