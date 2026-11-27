import { useState } from 'react';
import Button from '../ui/Button.jsx';
import Icon from '../ui/Icon.jsx';
import { TiptapContent } from '../content/ContentRenderer.jsx';
import { getQuestionTypeLabel } from '../../utils/helpers.js';
import {
  canSubmit,
  correctLabel,
  isResolved,
  matchProgress,
  questionTitle,
} from '../../utils/testRun.js';

/** Порядок из попытки + недостающие элементы (вопрос отредактировали после старта). */
function orderedIds(items, order) {
  const known = new Set(items.map((item) => item.id));
  const ids = (order ?? []).filter((id) => known.has(id));

  for (const item of items) if (!ids.includes(item.id)) ids.push(item.id);
  return ids;
}

/** Плашка обратной связи: вердикт, правильный ответ и пояснение автора. */
function Feedback({ question, answer, graded, onLinkClick }) {
  if (!isResolved(answer)) return null;

  // В режиме ветвления оценки нет: показываем только пояснение автора.
  if (!graded) {
    if (!question.explanation) return null;

    return (
      <div className="test-feedback is-plain">
        <div className="test-feedback__body">
          <TiptapContent doc={question.explanation} onLinkClick={onLinkClick} />
        </div>
      </div>
    );
  }

  const correct = answer.verdict === 'correct';

  return (
    <div className={`test-feedback ${correct ? 'is-correct' : 'is-wrong'}`} role="status">
      <div className="test-feedback__head">
        <Icon name={correct ? 'check' : 'x'} size={18} />
        <strong>{correct ? 'Верно!' : 'Неверно'}</strong>
        {!correct && <span className="test-feedback__answer">Правильный ответ: {correctLabel(question)}</span>}
      </div>

      {question.explanation && (
        <div className="test-feedback__body">
          <TiptapContent doc={question.explanation} onLinkClick={onLinkClick} />
        </div>
      )}
    </div>
  );
}

/**
 * Вертикальный список вариантов «Один ответ» / «Несколько ответов».
 *
 * Клик только отмечает вариант: проверки и подсветки «верно / неверно» здесь
 * нет. Выбор живёт в черновике попытки, поэтому его можно менять сколько
 * угодно (в том числе снять) — проверка начинается по кнопке «Готово».
 */
function ChoiceQuestion({ question, answer, draft, optionOrder, graded, onDraft, onLinkClick }) {
  const options = question.options ?? [];
  const optionById = new Map(options.map((option) => [option.id, option]));
  const ids = orderedIds(options, optionOrder);
  const resolved = isResolved(answer);
  const selected = answer?.selected ?? draft?.selected ?? [];

  const choose = (option) => {
    if (resolved) return;

    // Повторный клик по выбранному варианту снимает выбор.
    if (question.type === 'single') {
      onDraft({ selected: selected.includes(option.id) ? [] : [option.id] });
      return;
    }

    const next = selected.includes(option.id)
      ? selected.filter((id) => id !== option.id)
      : [...selected, option.id];
    onDraft({ selected: next });
  };

  return (
    <>
      <ul className="test-options">
        {ids.map((id) => {
          const option = optionById.get(id);
          const picked = selected.includes(id);
          const correct = Boolean(option.isCorrect);

          const classes = ['test-option', picked ? 'is-picked' : ''];
          if (graded && resolved) {
            if (correct) classes.push('is-correct');
            else if (picked) classes.push('is-wrong');
          }

          return (
            <li key={id}>
              <button
                type="button"
                className={classes.filter(Boolean).join(' ')}
                aria-pressed={picked}
                disabled={resolved}
                onClick={() => choose(option)}
              >
                <span
                  className={`test-option__mark test-option__mark--${question.type === 'single' ? 'radio' : 'checkbox'}`}
                  aria-hidden="true"
                />
                <span className="test-option__text">{option.text}</span>
                {graded && resolved && correct && <Icon name="check" size={18} className="test-option__icon" />}
                {graded && resolved && picked && !correct && <Icon name="x" size={18} className="test-option__icon" />}
              </button>
            </li>
          );
        })}
      </ul>

      <Feedback question={question} answer={answer} graded={graded} onLinkClick={onLinkClick} />
    </>
  );
}

/**
 * Две колонки: клик по понятию слева, затем по значению справа.
 *
 * Пары собираются без проверки: соединение можно менять (клик по понятию
 * снимает его пару) вплоть до нажатия «Готово». Оценка появляется только после
 * отправки ответа.
 */
function MatchQuestion({ question, answer, draft, pairOrder, graded, onDraft, onLinkClick }) {
  const pairs = question.pairs ?? [];
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
  const rightIds = orderedIds(pairs, pairOrder);
  const matches = answer?.matches ?? draft?.matches ?? {};
  const resolved = isResolved(answer);
  const progress = matchProgress(question, matches);
  const usedRight = new Set(Object.values(matches));

  const [activeLeft, setActiveLeft] = useState(null);

  const pickLeft = (pair) => {
    if (resolved) return;

    // Уже соединённое понятие освобождаем: читатель хочет выбрать другое значение.
    if (matches[pair.id] !== undefined) {
      const next = { ...matches };
      delete next[pair.id];
      onDraft({ matches: next });
      setActiveLeft(pair.id);
      return;
    }

    setActiveLeft((current) => (current === pair.id ? null : pair.id));
  };

  const pickRight = (rightId) => {
    if (resolved || !activeLeft) return;

    const next = { ...matches, [activeLeft]: rightId };
    setActiveLeft(null);
    onDraft({ matches: next });
  };

  return (
    <>
      <p className="test-match__status">
        Соединено {progress.matched} из {progress.total}
      </p>

      <div className="test-match">
        <div className="test-match__col" aria-label="Понятия">
          {pairs.map((pair) => {
            const matched = matches[pair.id] !== undefined;
            const classes = ['test-match__tile', matched ? 'is-matched' : '', activeLeft === pair.id ? 'is-active' : '']
              .filter(Boolean)
              .join(' ');

            return (
              <button
                type="button"
                key={pair.id}
                className={classes}
                data-pair-id={pair.id}
                disabled={resolved}
                aria-pressed={activeLeft === pair.id}
                onClick={() => pickLeft(pair)}
              >
                {pair.left}
              </button>
            );
          })}
        </div>

        <div className="test-match__col" aria-label="Значения">
          {rightIds.map((id) => {
            const pair = pairById.get(id);
            const matched = usedRight.has(id);
            const classes = ['test-match__tile', matched ? 'is-matched' : ''].filter(Boolean).join(' ');

            return (
              <button
                type="button"
                key={id}
                className={classes}
                data-pair-id={id}
                disabled={resolved || matched}
                onClick={() => pickRight(id)}
              >
                {pair.right}
              </button>
            );
          })}
        </div>
      </div>

      {!resolved && (
        <p className="test-match__hint">
          Нажмите понятие слева, затем его значение справа. Чтобы поменять пару, нажмите на понятие ещё раз.
        </p>
      )}

      <Feedback question={question} answer={answer} graded={graded} onLinkClick={onLinkClick} />
    </>
  );
}

/**
 * Карточка: передняя сторона, две круглые кнопки и переворот после ответа.
 * «Знаю / Не знаю» — это и есть ответ, поэтому он сразу уходит в проверку.
 */
function CardQuestion({ question, answer, graded, onSubmit }) {
  const data = question.data ?? {};
  const resolved = isResolved(answer);
  const know = answer?.know ?? (answer?.verdict === 'correct' ? true : answer?.verdict === 'wrong' ? false : null);

  return (
    <>
      <div className={`test-flashcard${resolved ? ' is-flipped' : ''}`}>
        <div className="test-flashcard__inner">
          <div className="test-flashcard__face">
            {data.front && <p className="test-flashcard__text">{data.front}</p>}
            {data.frontImage && <img className="test-flashcard__image" src={data.frontImage} alt="Передняя сторона" />}
            {!data.front && !data.frontImage && <p className="test-flashcard__text">—</p>}
          </div>

          <div className="test-flashcard__face test-flashcard__face--back">
            {data.back && <p className="test-flashcard__text">{data.back}</p>}
            {data.backImage && <img className="test-flashcard__image" src={data.backImage} alt="Задняя сторона" />}
            {!data.back && !data.backImage && <p className="test-flashcard__text">—</p>}
          </div>
        </div>
      </div>

      <div className="test-flashcard__actions">
        <button
          type="button"
          className={`test-flashcard__action is-no${resolved && know === false ? ' is-active' : ''}`}
          aria-label="Не знаю"
          title="Не знаю"
          disabled={resolved}
          onClick={() => onSubmit({ know: false })}
        >
          <span className="test-flashcard__round" aria-hidden="true">
            <Icon name="x" size={22} />
          </span>
          <span className="test-flashcard__action-label">Не знаю</span>
        </button>

        <button
          type="button"
          className={`test-flashcard__action is-yes${resolved && know === true ? ' is-active' : ''}`}
          aria-label="Знаю"
          title="Знаю"
          disabled={resolved}
          onClick={() => onSubmit({ know: true })}
        >
          <span className="test-flashcard__round" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <span className="test-flashcard__action-label">Знаю</span>
        </button>
      </div>

      {graded && resolved && (
        <p className={`test-flashcard__verdict is-${answer.verdict}`}>
          {answer.verdict === 'correct' ? 'Верно — вы знали ответ' : 'Правильный ответ на обороте карточки'}
        </p>
      )}
    </>
  );
}

/**
 * Подсказка рядом с кнопкой «Готово»: до отправки выбор можно менять.
 */
function submitHint(question, graded, ready) {
  if (question.type === 'match') {
    return ready ? 'Пары можно менять до нажатия «Готово».' : 'Соедините все пары и нажмите «Готово».';
  }

  if (!graded) return ready ? 'Кнопка «Готово» зафиксирует выбор.' : 'Отметьте вариант, чтобы продолжить.';

  return ready
    ? 'Выбор можно менять до нажатия «Готово».'
    : 'Отметьте вариант ответа и нажмите «Готово».';
}

/**
 * Текущий вопрос читателя. Выбор варианта — черновик: подсветки «верно /
 * неверно» нет, ответ можно менять до нажатия «Готово» в правом нижнем углу
 * карточки вопроса. Только «Готово» фиксирует ответ, проверяет его (в тесте с
 * оценкой) и блокирует варианты. В режиме ветвления выбор ведёт по пути.
 */
export default function ReaderQuestion({
  question,
  index,
  total,
  answer,
  draft,
  optionOrder,
  pairOrder,
  graded = true,
  onSubmit,
  onDraft,
  onLinkClick,
}) {
  const resolved = isResolved(answer);
  const selected = answer?.selected ?? draft?.selected ?? [];
  const matches = answer?.matches ?? draft?.matches ?? {};
  const value = question.type === 'match' ? { matches } : { selected };
  const ready = canSubmit(question, value);

  return (
    <article className="test-question" data-question-id={question.id}>
      <header className="test-question__head">
        <span className="test-question__step">
          Вопрос {index + 1} из {total}
        </span>

        <span className="badge badge--gray">
          <Icon name="clipboard" size={14} />
          {getQuestionTypeLabel(question.type)}
        </span>

        {question.group?.name && <span className="test-question__group">{question.group.name}</span>}
        {question.section?.title && <span className="test-question__group">{question.section.title}</span>}

        {graded && resolved && (
          <span className={`test-question__verdict is-${answer.verdict}`}>
            {answer.verdict === 'correct' ? 'Верно' : 'Неверно'}
          </span>
        )}
      </header>

      {question.type !== 'card' && <h2 className="test-question__title">{questionTitle(question)}</h2>}

      {(question.type === 'single' || question.type === 'multiple') && (
        <ChoiceQuestion
          question={question}
          answer={answer}
          draft={draft}
          optionOrder={optionOrder}
          graded={graded}
          onDraft={onDraft}
          onLinkClick={onLinkClick}
        />
      )}

      {question.type === 'match' && (
        <MatchQuestion
          question={question}
          answer={answer}
          draft={draft}
          pairOrder={pairOrder}
          graded={graded}
          onDraft={onDraft}
          onLinkClick={onLinkClick}
        />
      )}

      {question.type === 'card' && (
        <CardQuestion question={question} answer={answer} graded={graded} onSubmit={onSubmit} />
      )}

      {question.type !== 'card' && !resolved && (
        <div className="test-question__submit">
          <span className="test-question__submit-hint">{submitHint(question, graded, ready)}</span>
          <Button onClick={() => onSubmit(value)} disabled={!ready}>
            Готово
          </Button>
        </div>
      )}
    </article>
  );
}

